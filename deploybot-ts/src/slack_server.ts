import { Request, Response } from 'express'
import Redis from 'ioredis'
import crypto from 'crypto'
import { slack } from './tools/slack'

// Re-export these for use in server.ts
export const SLACK_CLIENT_ID = process.env.SLACK_CLIENT_ID
export const SLACK_CLIENT_SECRET = process.env.SLACK_CLIENT_SECRET
export const SLACK_REDIRECT_URI = process.env.SLACK_REDIRECT_URI || 'http://localhost:8001/slack/oauth/callback'

const redis = new Redis(process.env.REDIS_CACHE_URL || 'redis://redis:6379/1')

// Generate secure state parameter for OAuth
export async function generateOAuthState(): Promise<string> {
  const state = crypto.randomBytes(32).toString('hex')
  await redis.set(`slack_oauth_state:${state}`, '1', 'EX', 600) // Expire in 10 minutes
  return state
}

export async function handleSlackConnect(req: Request, res: Response) {
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
}

// Add helper function to get token for a team
export async function getSlackToken(teamId: string): Promise<string | null> {
  const tokenData = await redis.get(`slack_token:${teamId}`)
  if (!tokenData) return null
  
  const data = JSON.parse(tokenData)
  return data.access_token
}

// Verify OAuth state parameter
export async function verifyOAuthState(state: string): Promise<boolean> {
  const exists = await redis.get(`slack_oauth_state:${state}`)
  if (exists) {
    await redis.del(`slack_oauth_state:${state}`)
    return true
  }
  return false
}

export function handleSlackSuccess(req: Request, res: Response) {
  res.send(`
    <html>
      <body>
        <h1>Success!</h1>
        <p>The Slack app has been successfully installed.</p>
        <p>You can close this window now.</p>
      </body>
    </html>
  `)
}

export async function handleSlackCallback(req: Request, res: Response) {
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
} 