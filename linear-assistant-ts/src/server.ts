import express, { Express, Request, Response } from 'express'
import { LinearClient } from '@linear/sdk'
import { FunctionCall, HumanContact, humanlayer } from 'humanlayer'
import { EmailPayload } from './vendored'
import Redis from 'ioredis'
import { LoopsClient } from 'loops'
import { Webhook } from 'svix'
import bodyParser from 'body-parser'
import {
  b,
} from './baml_client'

import { handleHumanResponse, handleNextStep, threadToPrompt, Thread, Event, newLogger, _handleNextStep } from './agent'

const linearClient = new LinearClient({ apiKey: process.env.LINEAR_API_KEY })
const loops = process.env.LOOPS_API_KEY ? new LoopsClient(process.env.LOOPS_API_KEY) : undefined
const redis = new Redis(process.env.REDIS_CACHE_URL || 'redis://redis:6379/1')

const HUMANLAYER_API_KEY = process.env.HUMANLAYER_API_KEY_NAME ? process.env[process.env.HUMANLAYER_API_KEY_NAME] : process.env.HUMANLAYER_API_KEY

redis.on('error', err => {
  console.error('Redis connection error:', err)
})

redis.on('connect', () => {
  console.log('Connected to Redis')
})

const cacheStats = {
  hits: 0,
  misses: 0,
  getHitRate: () => {
    const total = cacheStats.hits + cacheStats.misses
    return total === 0 ? 0 : (cacheStats.hits / total) * 100
  },
  reset: () => {
    cacheStats.hits = 0
    cacheStats.misses = 0
  },
}

setInterval(() => {
  const hitRate = cacheStats.getHitRate()
  console.log(
    `Cache stats - Hits: ${cacheStats.hits}, Misses: ${cacheStats.misses}, Hit Rate: ${hitRate.toFixed(
      2,
    )}%`,
  )
}, 60 * 60 * 1000)

const debug: boolean = !!process.env.DEBUG
const debugDisableWebhookVerification: boolean = process.env.DEBUG_DISABLE_WEBHOOK_VERIFICATION === 'true'

const app: Express = express()
const port = process.env.PORT || 8000

const getAllowedEmails = (): Set<string> => {
  const allowedEmails = process.env.ALLOWED_SOURCE_EMAILS || ''
  return new Set(
    allowedEmails
      .split(',')
      .map(email => email.trim())
      .filter(Boolean),
  )
}

const getTargetEmails = (): Set<string> => {
  const targetEmails = process.env.ALLOWED_TARGET_EMAILS || ''
  return new Set(
    targetEmails
      .split(',')
      .map(email => email.trim())
      .filter(Boolean),
  )
}

type EmailWebhookPayload = {
  is_test: boolean
  event: EmailPayload
  type: 'agent_email.received'
}

type HumanContactWebhookPayload = {
  is_test: boolean
  event: HumanContact
  type: 'human_contact.completed'
}

type FunctionCallWebhookPayload = {
  is_test: boolean
  event: FunctionCall
  type: 'function_call.completed'
}

type WebhookPayload = EmailWebhookPayload | HumanContactWebhookPayload | FunctionCallWebhookPayload

const newEmailThreadHandler = async (payload: EmailWebhookPayload, res: Response) => {
  const threadId = (Math.random() * 1000000).toString()
  const logger = newLogger(threadId)

  if (payload.is_test || payload.event.from_address === 'overworked-admin@coolcompany.com') {
    logger.log('test email received, skipping')
    res.json({ status: 'ok', intent: 'test' })
    return
  }

  let fromAddress = payload.event.from_address
  const emailMatch = fromAddress.match(/<(.+?)>/)
  if (emailMatch) {
    fromAddress = emailMatch[1]
  }

  let toAddress = payload.event.to_address
  const toEmailMatch = toAddress.match(/<(.+?)>/)
  if (toEmailMatch) {
    toAddress = toEmailMatch[1]
  }

  const allowedEmails = getAllowedEmails()
  const targetEmails = getTargetEmails()
  console.log(`allowedEmails: ${Array.from(allowedEmails).join(',')}`)
  console.log(`targetEmails: ${Array.from(targetEmails).join(',')}`)

  if (allowedEmails.size > 0 && !allowedEmails.has(fromAddress)) {
    console.log(
      `email from non-allowed sender ${payload.event.from_address} (parsed as ${fromAddress}), skipping`,
    )
    res.json({ status: 'ok', intent: 'meh' })
    return
  }

  if (targetEmails.size > 0 && !targetEmails.has(toAddress)) {
    console.log(
      `email to non-target address ${payload.event.to_address} (parsed as ${toAddress}), skipping`,
    )
    res.json({ status: 'ok', intent: 'meh' })
    return
  }

  console.log(`new email received from ${payload.event.from_address} to ${payload.event.to_address}`)

  res.json({ status: 'ok' })

  Promise.resolve().then(async () => {
    const body: EmailPayload = payload.event
    let thread: Thread = {
      id: (Math.random() * 1000000).toString(),
      initial_email: body,
      events: [
        {
          type: 'email_received',
          data: body,
        },
      ],
    }

    const logger = newLogger(thread.id)

    try {
      const _fake_humanlayer = undefined as any

      const prefillOps = [
        { intent: 'list_projects' },
        { intent: 'list_teams' },
        { intent: 'list_users' },
        { intent: 'list_labels' },
        { intent: 'list_workflow_states' },
      ];

      if (process.env.LOOPS_API_KEY) {
        prefillOps.push({ intent: 'list_loops_mailing_lists' });
      }

      // dont need results, this mutates the thread
      await Promise.all(
        prefillOps.map(op => {
          logger.log(`Prefilling context for ${op.intent}`);
          return _handleNextStep(thread, op as any, _fake_humanlayer, linearClient, loops, redis);
        })
      );

      await handleNextStep(thread, linearClient, loops, redis)
    } catch (e) {
      console.error(`Error processing new email thread: ${e}`)
    }
  })
}

const callCompletedHandler = async (
  payload: HumanContactWebhookPayload | FunctionCallWebhookPayload,
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

  res.json({ status: 'ok' })

  Promise.resolve().then(async () => {
    let thread: Thread
    thread = humanResponse.spec.state as Thread
    const logger = newLogger(thread.id)
    logger.log(`human_response received: ${JSON.stringify(humanResponse)}`)
    try {
      await handleHumanResponse(thread, payload, linearClient, loops, redis)
    } catch (e) {
      logger.error(`Error processing human response: ${e}`)
    }
  })
}

const webhookSecret = process.env.WEBHOOK_SIGNING_SECRET_NAME ? process.env[process.env.WEBHOOK_SIGNING_SECRET_NAME] : process.env.WEBHOOK_SIGNING_SECRET
if (!webhookSecret) {
  console.error('WEBHOOK_SIGNING_SECRET environment variable is required')
  process.exit(1)
}

const wh = new Webhook(webhookSecret)

const verifyWebhook = (req: Request, res: Response): boolean => {
  if (debugDisableWebhookVerification) {
    return true;
  }
  
  const payload = req.body
  const headers = req.headers
  try {
    let msg
    try {
      msg = wh.verify(payload, headers as Record<string, string>)
    } catch (err) {
      res.status(400).json({})
    }
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

const webhookHandler = (req: Request, res: Response) => {
  if (!verifyWebhook(req, res)) {
    return
  }

  const payload = JSON.parse(req.body) as WebhookPayload

  console.log(`webhook received: ${JSON.stringify(payload.type)}`)

  switch (payload.type) {
    case 'agent_email.received':
      return newEmailThreadHandler(payload, res)
    case 'human_contact.completed':
      return callCompletedHandler(payload, res)
    case 'function_call.completed':
      return callCompletedHandler(payload, res)
    default:
      console.log(`unknown webhook type: ${(payload as any).type }`)
      res.status(400).json({ error: 'Unknown webhook type' })
  }
}

app.post('/webhook/generic', bodyParser.raw({ type: 'application/json' }), webhookHandler)
app.post('/webhook/new-email-thread', bodyParser.raw({ type: 'application/json' }), webhookHandler)
app.post(
  '/webhook/human-response-on-existing-thread',
  bodyParser.raw({ type: 'application/json' }),
  webhookHandler,
)

app.get('/health', async (req: Request, res: Response) => {
  const nextStep = await b.DetermineNextStep(
    '<inbound_email>make a ticket for austin to stock the fridges</inbound_email>',
  )

  switch (nextStep.intent) {
    case 'create_issue':
      res.json({ status: 'ok', intent: nextStep.intent })
      break
    default:
      res.json({ status: 'ok', intent: nextStep.intent })
  }
})

app.get('/', async (req: Request, res: Response) => {
  res.json({
    welcome: 'to the linear assistant',
    instructions: 'https://github.com/got-agents/agents',
  })
})

app.use((req: Request, res: Response) => {
  res.status(404).json({
    status: 'error',
    message: 'Not found',
  })
})

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
