import Redis from 'ioredis'
import { Thread } from './agent'

const redis = new Redis(process.env.REDIS_CACHE_URL || 'redis://redis:6379/1')

export async function saveThreadState(thread: Thread): Promise<string> {
  const stateId = `thread_${Date.now()}_${Math.random().toString(36).substring(7)}`
  await redis.set(stateId, JSON.stringify(thread))
  return stateId
}

export async function getThreadState(stateId: string): Promise<Thread | null> {
  const state = await redis.get(stateId)
  return state ? JSON.parse(state) : null
}

export async function getSlackTokenForTeam(teamId: string): Promise<string | null> {
  try {
    const tokenData = await redis.get(`slack_token:${teamId}`)
    if (!tokenData) {
      console.error(`No Slack token found for team ${teamId}`)
      return null
    }
    
    const { access_token } = JSON.parse(tokenData)
    console.log('Found token for team:', teamId)
    return access_token
  } catch (error) {
    console.error(`Error retrieving Slack token for team ${teamId}:`, error)
    return null
  }
}

interface SlackTokenData {
  access_token: string
  team_id: string
  team_name?: string
  bot_user_id?: string
  installed_at: number
}

export async function saveSlackToken(teamId: string, tokenData: SlackTokenData): Promise<void> {
  try {
    await redis.set(`slack_token:${teamId}`, JSON.stringify(tokenData))
    console.log('Token stored in Redis for team:', teamId)
  } catch (error) {
    console.error('Error saving Slack token:', error)
    throw error
  }
}

export async function generateOAuthState(): Promise<string> {
  const state = require('crypto').randomBytes(32).toString('hex')
  await redis.set(`slack_oauth_state:${state}`, '1', 'EX', 600) // Expire in 10 minutes
  return state
}

export async function verifyAndConsumeOAuthState(state: string): Promise<boolean> {
  const exists = await redis.get(`slack_oauth_state:${state}`)
  if (exists) {
    await redis.del(`slack_oauth_state:${state}`)
    return true
  }
  return false
}