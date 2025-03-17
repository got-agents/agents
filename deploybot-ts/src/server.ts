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

const debug: boolean = !!process.env.DEBUG
const debugDisableWebhookVerification: boolean = process.env.DEBUG_DISABLE_WEBHOOK_VERIFICATION === 'true'

const HUMANLAYER_API_KEY = process.env.HUMANLAYER_API_KEY_NAME ? process.env[process.env.HUMANLAYER_API_KEY_NAME] : process.env.HUMANLAYER_API_KEY

const redis = new Redis(process.env.REDIS_CACHE_URL || 'redis://redis:6379/1')

redis.on('error', err => {
  console.error('Redis connection error:', err)
})

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

  // Get team ID and look up token
  const teamId = payload.event.team_id
  console.log('Looking up token for team:', teamId)
  const tokenData = await redis.get(`slack_token:${teamId}`)
  if (!tokenData) {
    console.error(`No Slack token found for team ${teamId}`)
    res.status(400).json({ error: 'Team not authorized' })
    return
  }
  const { access_token } = JSON.parse(tokenData)
  console.log('Found token for team:', teamId)

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
    const contactChannel = {
      slack: {
        channel_or_user_id: thread.initial_slack_message?.channel_id || "",
        experimental_slack_blocks: true,
        slack_bot_token: access_token, // Pass the bot token to HumanLayer
      }
    }
    console.log('Creating HumanLayer client with channel:', JSON.stringify(contactChannel))
    const hl = humanlayer({ contactChannel, apiKey: HUMANLAYER_API_KEY })
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

  // Get team ID from payload
  let teamId: string | undefined
  if ('team_id' in payload.event) {
    teamId = payload.event.team_id
  } else if (payload.event.initial_slack_message?.team_id) {
    teamId = payload.event.initial_slack_message.team_id
  }

  // Process webhook asynchronously
  Promise.resolve().then(async () => {
    if (teamId) {
      const token = await getSlackToken(teamId)
      if (token) {
        // Create new WebClient instance with team's token
        const teamSlack = new WebClient(token)
        // TODO: Use teamSlack for any Slack API calls in the webhook handler
      }
    }
  })

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
app.get('/slack/connect', async (req: Request, res: Response) => {
  if (!SLACK_CLIENT_ID) {
    res.status(500).send('Slack client ID not configured')
    return
  }

  const state = await generateOAuthState()
  
  // Full list of required scopes
  const scopes = [
    'app_mentions:read',
    'users.profile:read',
    'users:read',
    'commands',
    'channels:history',
    'channels:read', 
    'chat:write',
    'groups:history',
    'groups:write',
    'im:history',
    'im:read',
    'im:write'
  ]

  // Redirect to Slack's OAuth page
  const url = `https://slack.com/oauth/v2/authorize?client_id=${SLACK_CLIENT_ID}&scope=${scopes.join(',')}&redirect_uri=${SLACK_REDIRECT_URI}&state=${state}`
  
  res.redirect(url)
})

app.get('/slack/oauth/callback', async (req: Request, res: Response) => {
  console.log('OAuth callback received:', {
    code: !!req.query.code,
    state: req.query.state,
    error: req.query.error
  })

  const { code, state, error } = req.query

  if (error) {
    console.error('OAuth error from Slack:', error)
    res.status(400).send(`Slack OAuth error: ${error}`)
    return
  }

  if (!code || !state) {
    console.error('Missing code or state:', { code: !!code, state: !!state })
    res.status(400).send('Missing code or state parameter')
    return
  }

  if (!await verifyOAuthState(state as string)) {
    console.error('Invalid state parameter:', state)
    res.status(400).send('Invalid state parameter')
    return
  }

  try {
    console.log('Exchanging code for token...')
    // Exchange code for token
    const result = await slack.oauth.v2.access({
      client_id: SLACK_CLIENT_ID!,
      client_secret: SLACK_CLIENT_SECRET!,
      code: code as string,
      redirect_uri: SLACK_REDIRECT_URI
    })

    if (!result.ok) {
      console.error('Slack OAuth error:', result.error)
      throw new Error(result.error)
    }

    console.log('Got successful OAuth response:', {
      team_id: result.team?.id,
      team_name: result.team?.name,
      ok: result.ok
    })

    // Store tokens in Redis
    const teamId = result.team?.id
    if (!teamId) {
      console.error('No team ID in OAuth response')
      throw new Error('No team ID in OAuth response')
    }

    console.log('Storing token for team:', teamId)
    const tokenData = JSON.stringify({
      access_token: result.access_token,
      team_id: teamId,
      team_name: result.team?.name,
      bot_user_id: result.bot_user_id,
      installed_at: Date.now()
    })
    console.log('Token data to store:', {
      team_id: teamId,
      team_name: result.team?.name,
      bot_user_id: result.bot_user_id,
      installed_at: Date.now()
    })

    try {
      await redis.set(`slack_token:${teamId}`, tokenData)
      console.log('Token stored in Redis')

      // Verify token was stored
      const storedToken = await redis.get(`slack_token:${teamId}`)
      console.log('Stored token verification:', {
        found: !!storedToken,
        matches: storedToken === tokenData
      })

      // List all keys
      const allKeys = await redis.keys('*')
      console.log('All Redis keys:', allKeys)

    } catch (redisError) {
      console.error('Redis error:', redisError)
      throw redisError
    }

    res.redirect('/slack/oauth/success')
  } catch (error) {
    console.error('Slack OAuth error:', error)
    res.status(500).send('Error completing Slack OAuth')
  }
})

app.get('/slack/oauth/success', (req: Request, res: Response) => {
  res.send(`
    <html>
      <body>
        <h1>Success!</h1>
        <p>The Slack app has been successfully installed.</p>
        <p>You can close this window now.</p>
      </body>
    </html>
  `)
})

// 404 handler - MUST be last
app.use((req: Request, res: Response) => {
  res.status(404).json({
    status: 'error',
    message: 'Not found',
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

const SLACK_CLIENT_ID = process.env.SLACK_CLIENT_ID
const SLACK_CLIENT_SECRET = process.env.SLACK_CLIENT_SECRET
const SLACK_REDIRECT_URI = process.env.SLACK_REDIRECT_URI || 'http://localhost:8001/slack/oauth/callback'

// Generate secure state parameter for OAuth
async function generateOAuthState(): Promise<string> {
  const state = crypto.randomBytes(32).toString('hex')
  await redis.set(`slack_oauth_state:${state}`, '1', 'EX', 600) // Expire in 10 minutes
  return state
}

// Verify OAuth state parameter
async function verifyOAuthState(state: string): Promise<boolean> {
  const exists = await redis.get(`slack_oauth_state:${state}`)
  if (exists) {
    await redis.del(`slack_oauth_state:${state}`)
    return true
  }
  return false
}

// Add helper function to get token for a team
async function getSlackToken(teamId: string): Promise<string | null> {
  const tokenData = await redis.get(`slack_token:${teamId}`)
  if (!tokenData) return null
  
  const data = JSON.parse(tokenData)
  return data.access_token
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
