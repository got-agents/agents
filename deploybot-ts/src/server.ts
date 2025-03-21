import express, { Express, Request, Response } from 'express'
import bodyParser from 'body-parser'
import {
  b,
} from './baml_client'
import { HumanContact, FunctionCall } from 'humanlayer'
import { EmailPayload, V1Beta2SlackEventReceived, V1Beta1AgentEmailReceived, V1Beta1HumanContactCompleted, V1Beta1FunctionCallCompleted } from './vendored'
import { Thread } from './agent'
import { handleHumanResponse, handleNextStep, stringifyToYaml } from './agent'
import { Webhook } from 'svix'
import Redis from 'ioredis'
import { getThreadState } from './state'
import crypto from 'crypto'
import { slack } from './tools/slack'
import { WebClient } from '@slack/web-api'
import { handleSlackConnect, SLACK_CLIENT_ID, SLACK_CLIENT_SECRET, SLACK_REDIRECT_URI, generateOAuthState, verifyOAuthState, getSlackToken, handleSlackSuccess, handleSlackCallback } from './slack_server'
import { shouldDropEmail as shouldDropEmail } from './server_email'
import { isPropertyAccessChain } from 'typescript'

const debug: boolean = !!process.env.DEBUG
const debugDisableWebhookVerification: boolean = process.env.DEBUG_DISABLE_WEBHOOK_VERIFICATION === 'true'

const HUMANLAYER_API_KEY = process.env.HUMANLAYER_API_KEY_NAME ? process.env[process.env.HUMANLAYER_API_KEY_NAME] : process.env.HUMANLAYER_API_KEY

const redis = new Redis(process.env.REDIS_CACHE_URL || 'redis://redis:6379/1')

redis.on('error', err => {
  console.error('Redis connection error:', err)
})

const app: Express = express()
const port = process.env.PORT || 8000

const newSlackThreadHandler = async (payload: V1Beta2SlackEventReceived, res: Response) => {
  console.log(`new slack thread received: ${JSON.stringify(payload)}`)

  // Get team ID and look up token
  const thread: Thread = {
    initial_slack_message: payload.event,
    events: [
      {
        type: 'slack_message_received',
        data: stringifyToYaml(payload),
      },
    ],
  }
  Promise.resolve().then(async () => {
    await handleNextStep(thread)
  })
  res.json({ status: 'ok' })
}

const callCompletedHandler = async (
  payload: V1Beta1HumanContactCompleted | V1Beta1FunctionCallCompleted,
  res: Response,
) => {
  const humanResponse: FunctionCall | HumanContact = payload.event

  if (debug) {
    console.log(`${JSON.stringify(humanResponse)}`)
  }

  if (!humanResponse.spec.state) {
    console.error('received human response without state')
    res.status(400)
    res.json({ status: 'error', error: 'state is required' })
    return
  }

  // Return immediately
  res.json({ status: 'ok' })

  // Process asynchronously
  Promise.resolve().then(async () => {
    try {
      let thread: Thread
      if (humanResponse.spec.state && 'stateId' in humanResponse.spec.state) {
        const stateId = (humanResponse.spec.state as { stateId: string }).stateId
        const loadedThread = await getThreadState(stateId)
        if (!loadedThread) {
          console.error(`Could not find thread state for ${stateId}`)
          return
        }
        thread = loadedThread
      } else {
        thread = humanResponse.spec.state as Thread
      }
      console.log(`human_response received: ${JSON.stringify(humanResponse)}`)
      await handleHumanResponse(thread, payload)
    } catch (e) {
      console.error('Error processing human response:', e)
    }
  })
}

const webhookHandler = (req: Request, res: Response) => {
  if (!debugDisableWebhookVerification && !verifyWebhook(req, res)) {
    return
  }

  const payload = JSON.parse(req.body) as WebhookPayload
  console.log(`event type: ${payload.type}`)


  switch (payload.type) {
    case 'agent_email.received':
      return newEmailThreadHandler(payload, res)
    case 'agent_slack.received':
      return newSlackThreadHandler(payload, res)
    case 'human_contact.completed':
      return callCompletedHandler(payload, res)
    case 'function_call.completed':
      return callCompletedHandler(payload, res)
  }
}

app.post('/webhook/generic', bodyParser.raw({ type: 'application/json' }), webhookHandler)
app.post('/webhook/new-email-thread', bodyParser.raw({ type: 'application/json' }), webhookHandler)
app.post(
  '/webhook/human-response-on-existing-thread',
  bodyParser.raw({ type: 'application/json' }),
  webhookHandler,
)

// Basic health check endpoint
app.get('/health', async (req: Request, res: Response) => {
  const nextStep = await b.DetermineNextStep(
    '<inbound_slack>do we have any commits that need to be deployed?</inbound_slack>',
  )
  res.json({ status: 'ok', nextStep})
})

app.get('/', async (req: Request, res: Response) => {
  res.json({
    welcome: 'to the deploybot assistant',
    instructions: 'https://github.com/got-agents/agents',
    slack: `${req.protocol}://${req.get('host')}/slack/connect`,
  })
})

// Slack OAuth routes - MUST be before the 404 handler
app.get('/slack/connect', handleSlackConnect)
app.get('/slack/oauth/callback', handleSlackCallback)
app.get('/slack/oauth/success', handleSlackSuccess)

// 404 handler - MUST be last
app.use((req: Request, res: Response) => {
  res.status(404).json({
    status: 'error',
    message: 'Not found',
  })
})

type WebhookPayload = V1Beta1AgentEmailReceived | V1Beta2SlackEventReceived | V1Beta1HumanContactCompleted | V1Beta1FunctionCallCompleted

const newEmailThreadHandler = async (payload: V1Beta1AgentEmailReceived, res: Response) => {
  const dropReason = shouldDropEmail(payload)
  if (dropReason) {
    res.json(dropReason)
    return
  }

  console.log(`new email received from ${payload.event.from_address} to ${payload.event.to_address}`)

  // Return immediately
  res.json({ status: 'ok' })

  // Process asynchronously
  Promise.resolve().then(async () => {
    const body: EmailPayload = payload.event
    let thread: Thread = {
      initial_email: body,
      events: [
        {
          type: 'email_received',
          data: body,
        },
      ],
    }

    // prefill context always, don't waste tool call round trips
    try {
      await handleNextStep(thread)
    } catch (e) {
      console.error('Error processing new email thread:', e)
    }
  })
}

// Add after other env var checks
const webhookSecret = process.env.WEBHOOK_SIGNING_SECRET_NAME ? process.env[process.env.WEBHOOK_SIGNING_SECRET_NAME] : process.env.WEBHOOK_SIGNING_SECRET

if (!webhookSecret) {
  console.error('WEBHOOK_SIGNING_SECRET environment variable is required')
  process.exit(1)
}

const wh = new Webhook(webhookSecret)

const verifyWebhook = (req: Request, res: Response): boolean => {
  const payload = req.body
  const headers = req.headers

  // Verify the webhook signature
  try {
    wh.verify(payload, {
      'svix-id': headers['svix-id'] as string,
      'svix-timestamp': headers['svix-timestamp'] as string,
      'svix-signature': headers['svix-signature'] as string,
    })
  } catch (err) {
    console.error('Webhook signature verification failed:', err)
    res.status(400).json({ error: 'Invalid webhook signature' })
    return false
  }
  return true
}

export async function serve() {
  app.listen(port, async () => {
    const apiBase = process.env.HUMANLAYER_API_BASE || 'http://host.docker.internal:8080/humanlayer/v1'
    console.log(`humanlayer api base: ${apiBase}`)

  console.log(`fetching project from ${apiBase}/project using ${process.env.HUMANLAYER_API_KEY_NAME}`)

  const project = await fetch(`${apiBase}/project`, {
    headers: {
      Authorization: `Bearer ${HUMANLAYER_API_KEY}`,
    },
  })
  console.log(await project.json())

  console.log(`Server running at http://localhost:${port}`)
  })
}
