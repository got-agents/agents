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