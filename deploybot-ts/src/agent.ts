import { ContactChannel, FunctionCall, HumanContact, humanlayer, HumanLayer } from 'humanlayer'
import {
  b,
  ClarificationRequest,
  DoneForNow,
  IntentListGitCommits,
  IntentListGitTags,
  IntentTagPushProd,
  IntentListVercelDeployments,
  IntentPromoteVercelDeployment,
  NothingToDo,
  Await,
  IntentListGithubWorkflowRuns,
} from './baml_client'
import Redis from 'ioredis'
import * as yaml from 'js-yaml'
import { V1Beta1FunctionCallCompleted, V1Beta1HumanContactCompleted, EmailPayload, SlackThread } from './vendored'
import { vercelClient } from './tools/vercel'
import { listGitCommits, listGithubWorkflows as listGithubWorkflowRuns, listGitTags, triggerWorkflowDispatch } from './tools/github'
import { saveThreadState, getThreadState, getSlackTokenForTeam } from './state'
const HUMANLAYER_API_KEY = process.env.HUMANLAYER_API_KEY_NAME ? process.env[process.env.HUMANLAYER_API_KEY_NAME] : process.env.HUMANLAYER_API_KEY

// Events and Threads
export interface Event {
  type: string;
  data: EmailPayload | 
  NothingToDo | 
  ClarificationRequest | 
  DoneForNow | 
  HumanResponse | 
  IntentListVercelDeployments | 
  IntentPromoteVercelDeployment | 
  IntentListGitCommits | 
  IntentListGitTags | 
  IntentListGithubWorkflowRuns | 
  IntentTagPushProd | 
  Await | 
  string;
}

export interface Thread {
  initial_email?: EmailPayload;
  initial_slack_message?: SlackThread;
  events: Event[];
}

export interface HumanResponse {
  event_type: "human_response"
  message: string
}

export function stringifyToYaml(obj: any): string {
  if (!obj) {
    return 'undefined'
  }

  const replacer = (key: string, value: any) => {
    if (typeof value === 'function') {
      return undefined
    }
    return value
  }

  const plainObj = JSON.parse(JSON.stringify(obj, replacer))

  return yaml.dump(plainObj, {
    skipInvalid: true,
    noRefs: true,
  })
}

const eventToPrompt = (event: Event) => {
  switch (event.type) {
    case 'email_received':
      const email = event.data as EmailPayload
      return `<${event.type}>
            From: ${email.from_address}
            To: ${email.to_address}
            Subject: ${email.subject}
            Body: ${email.body}
            Previous Thread: ${stringifyToYaml(email.previous_thread)}
</${event.type}>
        `
    default:
      const data = typeof event.data !== 'string' ? stringifyToYaml(event.data) : event.data
      return `<${event.type}>
          ${data}
</${event.type}>
      `
  }
}

const threadToPrompt = (thread: Thread) => {
  return thread.events.map(eventToPrompt).join('\n\n')
}

const appendResult = async (
  thread: Thread,
  fn: () => Promise<any>,
  cacheKey?: string,
): Promise<Thread> => {
  const lastEvent: Event = thread.events.slice(-1)[0]
  const responseType: string = lastEvent.type + '_result'
  if (!responseType) {
    thread.events.push({
      type: 'error',
      data: `No response type found for ${lastEvent.type} - something is wrong with your internal programming, please get help from a human`,
    })
    return thread
  }
  try {
    const result = await fn()
    thread.events.push({
      type: responseType,
      data: result,
    })
  } catch (e) {
    console.error(e)
    const errorEvent = await b.SquashResponseContext(
      threadToPrompt(thread),
      `error running ${thread.events.slice(-1)[0].type}: ${e}`,
    )
    thread.events.push({
      type: 'error',
      data: errorEvent,
    })
  }
  return thread
}

const _handleNextStep = async (
  thread: Thread,
  nextStep:
    | ClarificationRequest
    | DoneForNow
    | IntentListGitCommits
    | IntentListGitTags
    | IntentTagPushProd
    | IntentListVercelDeployments
    | IntentPromoteVercelDeployment
    | NothingToDo
    | Await
    | IntentListGithubWorkflowRuns,
  hl: HumanLayer,
): Promise<Thread | false> => {
  thread.events.push({
    type: nextStep.intent,
    data: nextStep,
  })
  let stateId: string | null = null
  switch (nextStep.intent) {
    case 'done_for_now':
      stateId = await saveThreadState(thread)

      await hl.createHumanContact({
        spec: {
          msg: nextStep.message,
          state: { stateId },
        },
      })
      console.log(`thread sent to humanlayer`)
      return false
    case 'request_more_information':

      stateId = await saveThreadState(thread)

      await hl.createHumanContact({
        spec: {
          msg: nextStep.message,
          state: { stateId },
        },
      })
      console.log(`thread sent to humanlayer`)
      return false
    case 'nothing_to_do':

      stateId = await saveThreadState(thread)

      console.log(`NOTHING TO DO - ${nextStep.message}`)

      if (process.env.DEBUG_CONTACT_HUMAN_ON_NOTHING_TO_DO) {
        await hl.createHumanContact({
          spec: {
            msg: `NOTHING TO DO - ${nextStep.message}`,
            state: { stateId },
          }
        })
        console.log(`thread sent to humanlayer`)
      }

      return false
    case 'await':
      // todo we should have a tool to do this durably :slight_smile:
      console.log(`awaiting ${nextStep.seconds} seconds, reasoning: ${nextStep.reasoning}`)
      return await appendResult(thread, async () => {
        await new Promise(resolve => setTimeout(resolve, nextStep.seconds * 1000))
        return {
          status: `successfully waited ${nextStep.seconds} seconds`,
        }
      })
    case 'list_git_commits':
      return await appendResult(thread, async () => {
        return listGitCommits({limit: nextStep.limit || 20})
      })
    case 'list_git_tags':
      return await appendResult(thread, async () => {
        return listGitTags({limit: nextStep.limit || 20})
      })
    case 'tag_push_prod':
      stateId = await saveThreadState(thread)
      await hl.createFunctionCall({
        spec: {
          fn: 'tag_push_prod',
          kwargs: {
            sha_to_deploy: nextStep.new_commit.sha,
            new_commit: nextStep.new_commit.markdown,
            previous_commit: nextStep.previous_commit.markdown,
          },
          state: { stateId },
        },
      })
      return false
    case 'list_vercel_deployments':
      return await appendResult(thread, async () => {
        return vercelClient().getRecentDeployments()
      })
    case 'promote_vercel_deployment':
      stateId = await saveThreadState(thread)
      await hl.createFunctionCall({
        spec: {
          fn: 'promote_vercel_deployment',
            kwargs: {
              new_deployment_sha: nextStep.vercel_deployment.git_commit_sha,
              new_deployment: nextStep.vercel_deployment.markdown,
              previous_deployment: nextStep.previous_deployment.markdown,
            },
          state: { stateId },
        },
      })
      return false
    case 'list_github_workflow_runs':
      return await appendResult(thread, async () => {
        return listGithubWorkflowRuns({workflowId: nextStep.workflow_id, limit: nextStep.limit || 3})
      })
    default:
      thread.events.push({
        type: 'error',
        data: `you called a tool that is not implemented: ${(nextStep as any).intent}, something is wrong with your internal programming, please get help from a human`,
      })
      return thread
  }
}


export const handleNextStep = async (thread: Thread): Promise<void> => {
  console.log(`thread: ${JSON.stringify(thread)}`)

  let contactChannel: ContactChannel | null = null

  if (thread.initial_slack_message) {
    const teamId = thread.initial_slack_message.team_id
    console.log('Looking up token for team:', teamId)
    
    const slackBotToken = await getSlackTokenForTeam(teamId)
    
    contactChannel = {
      slack: {
        channel_or_user_id: thread.initial_slack_message?.channel_id || "",
        experimental_slack_blocks: true,
        bot_token: slackBotToken || undefined,
      }
    }
  } else if (thread.initial_email) {
    contactChannel = {
      email: {
        address: thread.initial_email.from_address,
        experimental_subject_line: thread.initial_email.subject,
        experimental_in_reply_to_message_id: thread.initial_email.message_id,
        experimental_references_message_id: thread.initial_email.message_id,
      }
    }
  }

  console.log(`contactChannel: ${JSON.stringify(contactChannel)}`)
  const hl = humanlayer({ contactChannel: contactChannel || undefined, apiKey: HUMANLAYER_API_KEY })

  let nextThread: Thread | false = thread

  while (true) {
    const nextStep = await b.DetermineNextStep(threadToPrompt(nextThread))

    console.log(`===============`)
    console.log(threadToPrompt(thread))
    console.log(nextStep)
    console.log(`===============`)

    nextThread = await _handleNextStep(thread, nextStep, hl)
    if (!nextThread) {
      break
    }
  }
}

export const handleHumanResponse = async (
  thread: Thread,
  payload: V1Beta1HumanContactCompleted | V1Beta1FunctionCallCompleted,
): Promise<void> => {
  const humanResponse = payload.event

  if (payload.type === 'human_contact.completed') {
    const humanContact = humanResponse as HumanContact
    thread.events.push({
      type: 'human_response',
      data: humanContact.status?.response!,
    })
    return await handleNextStep(thread)
  } else if (payload.type === 'function_call.completed') {
    const functionCall = humanResponse as FunctionCall
    const stateId = (functionCall.spec.state as any).stateId
    let currentThread = stateId ? await getThreadState(stateId) : null
    if (!currentThread) {
      currentThread = thread
    }

    if (!functionCall.status?.approved) {
      currentThread.events.push({
        type: 'human_response',
        data: `User denied ${functionCall.spec.fn} with feedback: ${
          functionCall.status?.comment || '(No comment provided)'
        }`,
      })
      return await handleNextStep(currentThread)
    } else if (functionCall.spec.fn === 'promote_vercel_deployment') {
      const updatedThread = await appendResult(currentThread, async () => {
        console.log(`promoting vercel deployment: ${functionCall.spec.kwargs.new_deployment}`)
        console.log(`previous deployment: ${functionCall.spec.kwargs.previous_deployment}`)
        const resp = await triggerWorkflowDispatch(
          'vercel-promote-to-prod.yaml',
          'main',
          {
            'git_sha': functionCall.spec.kwargs.new_deployment_sha,
          })
        console.log(`resp: ${resp}`)
        return resp
      })
      return await handleNextStep(updatedThread)
    } else if (functionCall.spec.fn === 'tag_push_prod') {
      const updatedThread = await appendResult(currentThread, async () => {
        console.log(`tagging and pushing to prod: ${functionCall.spec.kwargs.new_commit}`)
        console.log(`previous commit: ${functionCall.spec.kwargs.previous_commit}`)
        const resp = await triggerWorkflowDispatch(
          'tag-and-push-prod.yaml',
          'main',
        )
      })
      return await handleNextStep(updatedThread)
    } else {
      currentThread.events.push({
        type: 'error',
        data: `Unknown intent: ${functionCall.spec.fn}`,
      })
      return await handleNextStep(currentThread)
    }
  }

  throw new Error(`Could not determine human response type: ${JSON.stringify(humanResponse)}`)
}