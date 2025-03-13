
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

const newSlackThreadHandler = async (payload: V1Beta2SlackEventReceived, res: Response) => {
  console.log(`new slack thread received: ${JSON.stringify(payload)}`)

  // todo validate allowed users/channels like we do for emails

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
      thread = humanResponse.spec.state as Thread
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
  })
})

app.use((req: Request, res: Response) => {
  res.status(404).json({
    status: 'error',
    message: 'Not found',
  })
})

app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    message: 'DeployBot Assistant is running',
  })
})


type WebhookPayload = V1Beta1AgentEmailReceived | V1Beta2SlackEventReceived | V1Beta1HumanContactCompleted | V1Beta1FunctionCallCompleted

const newEmailThreadHandler = async (payload: V1Beta1AgentEmailReceived, res: Response) => {
  if (payload.is_test || payload.event.from_address === 'overworked-admin@coolcompany.com') {
    console.log('test email received, skipping')
    res.json({ status: 'ok', intent: 'test' })
    return
  }

  // Check if email is in "Name <email>" format and extract just the email
  let fromAddress = payload.event.from_address
  const emailMatch = fromAddress.match(/<(.+?)>/)
  if (emailMatch) {
    fromAddress = emailMatch[1]
  }

  // Extract target email from to_address
  let toAddress = payload.event.to_address
  const toEmailMatch = toAddress.match(/<(.+?)>/)
  if (toEmailMatch) {
    toAddress = toEmailMatch[1]
  }

  const allowedEmails = getAllowedEmails()
  const targetEmails = getTargetEmails()
  console.log(`allowedEmails: ${Array.from(allowedEmails).join(',')}`)
  console.log(`targetEmails: ${Array.from(targetEmails).join(',')}`)

  // Check if sender is allowed (if allowlist is configured)
  if (allowedEmails.size > 0 && !allowedEmails.has(fromAddress)) {
    console.log(
      `email from non-allowed sender ${payload.event.from_address} (parsed as ${fromAddress}), skipping`,
    )
    res.json({ status: 'ok', intent: 'meh' })
    return
  }

  // Check if target email is allowed (if target list is configured)
  if (targetEmails.size > 0 && !targetEmails.has(toAddress)) {
    console.log(
      `email to non-target address ${payload.event.to_address} (parsed as ${toAddress}), skipping`,
    )
    res.json({ status: 'ok', intent: 'meh' })
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
const webhookSecret = process.env.WEBHOOK_SIGNING_SECRET
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
    const apiBase = process.env.HUMANLAYER_API_BASE || 'https://api.humanlayer.dev/humanlayer/v1'
    console.log(`humanlayer api base: ${apiBase}`)

  console.log(`fetching project from ${apiBase}/project`)
  const project = await fetch(`${apiBase}/project`, {
    headers: {
      Authorization: `Bearer ${process.env.DEPLOYBOT_HUMANLAYER_API_KEY}`,
    },
  })
  console.log(await project.json())

  console.log(`Server running at http://localhost:${port}`)
  })
}


