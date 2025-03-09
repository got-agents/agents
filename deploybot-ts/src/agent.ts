import { FunctionCall, HumanContact, humanlayer, HumanLayer } from 'humanlayer'
import {
  b,
  ClarificationRequest,
  DoneForNow,
  IntentListGitCommits,
  IntentListGitTags,
  IntentPushGitTag,
  IntentListVercelDeployments,
  IntentPromoteVercelDeployment,
} from './baml_client'

import * as yaml from 'js-yaml'
import { V1Beta1FunctionCallCompleted, V1Beta1HumanContactCompleted, EmailPayload, SlackThread } from './vendored'
import { listVercelDeployments } from './tools/vercel'


// Events and Threads
export interface Event {
  type: string;
  data: EmailPayload | ClarificationRequest | DoneForNow | HumanResponse | IntentListVercelDeployments | IntentPromoteVercelDeployment | IntentListGitCommits | IntentListGitTags | IntentPushGitTag | string;
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
  // Custom replacer function to ignore functions
  const replacer = (key: string, value: any) => {
    if (typeof value === 'function') {
      return undefined // Ignore functions
    }
    return value
  }

  // Convert object to a plain JavaScript object, ignoring functions
  const plainObj = JSON.parse(JSON.stringify(obj, replacer))

  // Convert to YAML
  return yaml.dump(plainObj, {
    skipInvalid: true, // Skip invalid YAML elements
    noRefs: true, // Don't output YAML references
  })
}

// accumulators are one honking great idea
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

const lastEventToResultType: Record<string, Event['type']> = {
  list_git_commits: 'list_git_commits_result',
  list_git_tags: 'list_git_tags_result',
  push_git_tag: 'push_git_tag_result',
  list_vercel_deployments: 'list_vercel_deployments_result',
  promote_vercel_deployment: 'promote_vercel_deployment_result',
  error: 'error',
}



// Modify appendResult function to track cache stats
const appendResult = async (
  thread: Thread,
  fn: () => Promise<any>,
  cacheKey?: string,
): Promise<Thread> => {
  const lastEvent: Event = thread.events.slice(-1)[0]
  const responseType: Event['type'] = lastEventToResultType[lastEvent.type]
  if (!responseType) {
    thread.events.push({
      type: 'error',
      data: `No response type found for ${lastEvent.type} - something is wrong with your internal programming, please get help from a human`,
    })
    return thread
  }
  try {
    const result = await fn()
    const squashedEvent = await b.SquashResponseContext(threadToPrompt(thread), stringifyToYaml(result))
    thread.events.push({
      type: responseType,
      data: squashedEvent as string,
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

/**
 * return whether the outer thread should continue
 * @param thread
 * @param nextStep
 * @param hl
 * @returns
 */
const _handleNextStep = async (
  thread: Thread,
  nextStep:
    | ClarificationRequest
    | DoneForNow
    | IntentListGitCommits
    | IntentListGitTags
    | IntentPushGitTag
    | IntentListVercelDeployments
    | IntentPromoteVercelDeployment,
  hl: HumanLayer,
): Promise<Thread | false> => {
  thread.events.push({
    type: nextStep.intent,
    data: nextStep,
  })
  switch (nextStep.intent) {
    case 'done_for_now':
      thread.events.push({
        type: 'done_for_now',
        data: nextStep,
      })

      await hl.createHumanContact({
        spec: {
          msg: nextStep.message,
          state: thread,
        },
      })
      return false
    case 'request_more_information':
      thread.events.push({
        type: 'request_more_information',
        data: nextStep,
      })

      await hl.createHumanContact({
        spec: {
          msg: nextStep.message,
          state: thread,
        },
      })
      console.log(`thread sent to humanlayer`)
      return false
    case 'list_git_commits':
      return await appendResult(thread, async () => {
        return 'fetching commits is not supported yet'
      })
    case 'list_git_tags':
      return await appendResult(thread, async () => {
        return 'fetching tags is not supported yet'
      })
    case 'push_git_tag':
      return await appendResult(thread, async () => {
        return 'pushing tags is not supported yet'
      })
    case 'list_vercel_deployments':
      return await appendResult(thread, async () => {
        try {
          const deployments = await listVercelDeployments();
          return {
            deployments,
            message: `Found ${deployments.length} recent deployments.`
          };
        } catch (error: any) {
          console.error('Error listing deployments:', error);
          return `Error fetching Vercel deployments: ${error}`;
        }
      })
    case 'promote_vercel_deployment':
      return await appendResult(thread, async () => {
        return 'promoting deployments is not supported yet'
      })
    default:
      thread.events.push({
        type: 'error',
        data: `you called a tool that is not implemented: ${(nextStep as any).intent}, something is wrong with your internal programming, please get help from a human`,
      })
      return thread
  }
}

// just keep folding
export const handleNextStep = async (thread: Thread): Promise<void> => {
  console.log(`thread: ${JSON.stringify(thread)}`)

  const contactChannel = thread.initial_email ? {
    email: {
      address: thread.initial_email.from_address,
      subject: thread.initial_email.subject,
      body: thread.initial_email.body,
    }
  } : {
    slack: {
      channel_or_user_id: thread.initial_slack_message?.channel_id || "",
      // todo support threads?
      // thread_ts: thread.initial_slack_message?.thread_ts || "",
    }
  }

  console.log(`contactChannel: ${JSON.stringify(contactChannel)}`)
  const hl = humanlayer({ contactChannel })


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
    // its a human contact, append the human response to the thread
    const humanContact = humanResponse as HumanContact
    thread.events.push({
      type: 'human_response',
      data: humanContact.status?.response!,
    })
    return await handleNextStep(thread)
  } else if (payload.type === 'function_call.completed') {
    // its a function call
    const functionCall = humanResponse as FunctionCall
    // check if it was approved
    if (!functionCall.status?.approved) {
      // denied? push the feedback to the thread and let the llm continue
      thread.events.push({
        type: 'human_response',
        data: `User denied ${functionCall.spec.fn} with feedback: ${
          functionCall.status?.comment || '(No comment provided)'
        }`,
      })
      return await handleNextStep(thread)
    } else if (functionCall.spec.fn === 'promote_vercel_deployment') {
      // promote_vercel_deployment approved, promote the deployment
      thread = await appendResult(thread, async () => {
        return 'promoting deployments is not supported yet'
      })
      return await handleNextStep(thread)
    } else if (functionCall.spec.fn === 'push_git_tag') {
      // push_git_tag approved, push the tag and tell the llm what happened
      thread = await appendResult(thread, async () => {
        return 'pushing tags is not supported yet'
      })
      return await handleNextStep(thread)
    } else {
      // unknown function name, push an error to the thread and let the llm continue
      thread.events.push({
        type: 'error',
        data: `Unknown intent: ${functionCall.spec.fn}`,
      })
      return await handleNextStep(thread)
    }
  }

  throw new Error(`Could not determine human response type: ${JSON.stringify(humanResponse)}`)
}