import { FunctionCall, HumanContact, humanlayer, HumanLayer } from 'humanlayer'
import {
  b,
  AddComment,
  AddUserToLoopsMailingList,
  ClarificationRequest,
  CreateIssue,
  DoneForNow,
  GetIssueComments,
  ListIssues,
  ListLabels,
  ListLoopsMailingLists,
  ListProjects,
  ListTeams,
  ListUsers,
  ListWorkflowStates,
  SearchIssues,
  SearchLabels,
  UpdateIssue,
} from './baml_client'

import * as yaml from 'js-yaml'
import { createHash } from 'crypto'
import { EmailPayload } from './vendored'
const HUMANLAYER_API_KEY = process.env.HUMANLAYER_API_KEY_NAME ? process.env[process.env.HUMANLAYER_API_KEY_NAME] : process.env.HUMANLAYER_API_KEY

export const newLogger = (id: string) => {
  return {
    log: (message: string) => {
      console.log(`${id} - ${message}`)
    },
    error: (message: string) => {
      console.error(`${id} - ${message}`)
    },
    warn: (message: string) => {
      console.warn(`${id} - ${message}`)
    },
    info: (message: string) => {
      console.info(`${id} - ${message}`)
    },
  }
}

const defaultLogger = newLogger('default')

export interface Event {
  type: string;
  data: EmailPayload | HumanResponse | CreateIssue | ListTeams | ListIssues | ClarificationRequest | 
        DoneForNow | ListUsers | AddComment | SearchIssues | GetIssueComments | ListLabels | 
        ListProjects | AddUserToLoopsMailingList | ListLoopsMailingLists | ListWorkflowStates | 
        UpdateIssue | SearchLabels | string;
}

export interface Thread {
  id: string; // internal id for logging
  initial_email: EmailPayload;
  events: Event[];
}

export interface HumanResponse {
  event_type: "human_response"
  message: string
}

export function stringifyToYaml(obj: any): string {
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

export const eventToPrompt = (event: Event) => {
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

export const threadToPrompt = (thread: Thread) => {
  return thread.events.map(eventToPrompt).join('\n\n')
}

export const lastEventToResultType: Record<string, Event['type']> = {
  create_issue: 'issue_create_result',
  add_comment: 'add_comment_result',
  list_teams: 'list_teams_result',
  list_users: 'list_users_result',
  list_issues: 'list_issues_result',
  list_labels: 'list_labels_result',
  get_issue_comments: 'get_issue_comments_result',
  search_issues: 'search_issues_result',
  list_projects: 'list_projects_result',
  add_user_to_loops_mailing_list: 'add_user_to_loops_mailing_list_result',
  list_loops_mailing_lists: 'list_loops_mailing_lists_result',
  list_workflow_states: 'list_workflow_states_result',
  update_issue: 'update_issue_result',
  search_labels: 'search_labels_result',
}

export const appendResult = async (
  thread: Thread,
  fn: () => Promise<any>,
  cacheKey?: string,
  redis?: any
): Promise<Thread> => {
  const logger = newLogger(thread.id)
  const lastEvent: Event = thread.events.slice(-1)[0]
  const responseType: Event['type'] = lastEventToResultType[lastEvent.type]
  if (!responseType) {
    thread.events.push({
      type: 'error',
      data: `No response type found for ${lastEvent.type} - something is wrong with your internal programming, time to get help`,
    })
    return thread
  }
  try {
    let result
    let squashedEvent
    if (cacheKey && redis) {
      const [cachedResult, cachedSquash] = await Promise.all([
        redis.get(cacheKey),
        redis.get(
          `squash_${cacheKey}_${createHash('sha256').update(threadToPrompt(thread)).digest('hex')}`,
        ),
      ])

      if (cachedResult && cachedSquash) {
        result = JSON.parse(cachedResult)
        squashedEvent = cachedSquash
      } else if (cachedResult) {
        result = JSON.parse(cachedResult)
        squashedEvent = await b.SquashResponseContext(threadToPrompt(thread), stringifyToYaml(result))
      } else {
        result = await fn()
        squashedEvent = await b.SquashResponseContext(threadToPrompt(thread), stringifyToYaml(result))
        if (redis) {
          const CACHE_TTL = 60 * 60 * 120
          await Promise.all([
            redis.setex(cacheKey, CACHE_TTL, JSON.stringify(result)),
            redis.setex(
              `squash_${cacheKey}_${createHash('sha256').update(threadToPrompt(thread)).digest('hex')}`,
              CACHE_TTL,
              squashedEvent,
            ),
          ])
        }
      }
    } else {
      result = await fn()
      squashedEvent = await b.SquashResponseContext(threadToPrompt(thread), stringifyToYaml(result))
    }
    logger.log(`pushing event: ${squashedEvent}`)
    thread.events.push({
      type: responseType,
      data: squashedEvent as string,
    })
  } catch (e) {
    logger.error(`error running ${thread.events.slice(-1)[0].type}: ${e}`)
    const errorEvent = await b.SquashResponseContext(
      threadToPrompt(thread),
      `error running ${thread.events.slice(-1)[0].type}: ${e}`,
    )
    logger.log(`pushing event: ${errorEvent}`)
    thread.events.push({
      type: 'error',
      data: errorEvent,
    })
  }
  return thread
}

export const _handleNextStep = async (
  thread: Thread,
  nextStep:
    | ClarificationRequest
    | CreateIssue
    | ListTeams
    | ListIssues
    | ListUsers
    | DoneForNow
    | AddComment
    | SearchIssues
    | GetIssueComments
    | ListLabels
    | ListProjects
    | AddUserToLoopsMailingList
    | ListLoopsMailingLists
    | ListWorkflowStates
    | UpdateIssue
    | SearchLabels,
  hl: HumanLayer,
  linearClient: any,
  loops?: any,
  redis?: any,
): Promise<Thread | false> => {
  const logger = newLogger(thread.id)
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
      logger.log(`thread sent to humanlayer`)
      return false
    case 'create_issue':
      thread.events.push({
        type: 'create_issue',
        data: nextStep,
      })

      try {
        await hl.createFunctionCall({
          spec: {
            fn: 'create_issue',
          kwargs: nextStep.issue,
          state: thread,
        },
      })
      } catch (e) {
        logger.error(`error creating function call object: ${JSON.stringify(e)}`)
        return false
      }
      logger.log(`thread sent to humanlayer`)
      return false
    case 'add_comment':
      thread.events.push({
        type: 'add_comment',
        data: nextStep,
      })
      await hl.createFunctionCall({
        spec: {
          fn: 'add_comment',
          kwargs: {
            issue_id: nextStep.issue_id,
            comment: nextStep.comment,
            view_issue_url: nextStep.view_issue_url,
          },
          state: thread,
        },
      })
      return false
    case 'list_teams':
      thread.events.push({
        type: 'list_teams',
        data: nextStep,
      })
      thread = await appendResult(thread, () => linearClient.teams(), 'teams', redis)
      return thread
    case 'list_users':
      thread.events.push({
        type: 'list_users',
        data: nextStep,
      })
      thread = await appendResult(thread, () => linearClient.users(), 'users', redis)
      return thread
    case 'list_projects':
      thread.events.push({
        type: 'list_projects',
        data: nextStep,
      })
      thread = await appendResult(thread, () => linearClient.projects(), 'projects', redis)
      return thread
    case 'search_issues':
      thread.events.push({
        type: 'search_issues',
        data: nextStep,
      })
      thread = await appendResult(
        thread,
        () => linearClient.searchIssues(nextStep.query),
        `search::${nextStep.query}`,
        redis
      )
      return thread
    case 'list_issues':
      thread.events.push({
        type: 'list_issues',
        data: nextStep,
      })
      thread = await appendResult(thread, () =>
        linearClient.issues({
          filter: {
            title: nextStep.filter?.title,
            description: nextStep.filter?.description,
            project: {
              id: {
                eq: nextStep.filter?.projectId,
              },
            },
            labels: {
              id: {
                in: nextStep.filter?.labelIds,
              },
            },
            state: {
              id: {
                eq: nextStep.filter?.stateId,
              },
            },
            createdAt: {
              gte: nextStep.filter?.createdAfter,
              lte: nextStep.filter?.createdBefore,
            },
            updatedAt: {
              gte: nextStep.filter?.updatedAfter,
              lte: nextStep.filter?.updatedBefore,
            },
          },
          first: nextStep.first,
          last: nextStep.last,
          after: nextStep.after,
          before: nextStep.before,
        }),
        undefined,
        redis
      )
      return thread
    case 'list_labels':
      thread.events.push({
        type: 'list_labels',
        data: nextStep,
      })
      const labelFilter = nextStep.label_name_contains
        ? {
            name: {
              contains: nextStep.label_name_contains,
            },
          }
        : undefined

      thread = await appendResult(
        thread,
        () => linearClient.issueLabels({ filter: labelFilter }),
        `labels::${nextStep.label_name_contains}`,
        redis
      )

      return thread
    case 'get_issue_comments':
      thread.events.push({
        type: 'get_issue_comments',
        data: nextStep,
      })
      thread = await appendResult(
        thread,
        async () => (await linearClient.issue(nextStep.issue_id)).comments(),
        `comments::${nextStep.issue_id}`,
        redis
      )
      return thread

    case 'list_workflow_states':
      thread.events.push({
        type: 'list_workflow_states',
        data: nextStep,
      })
      let filter = nextStep.team_id
        ? {
            team: {
              id: {
                eq: nextStep.team_id,
              },
            },
          }
        : undefined

      thread = await appendResult(
        thread,
        () => linearClient.workflowStates({ filter }),
        `workflow_states::${nextStep.team_id}`,
        redis
      )
      return thread
    case 'add_user_to_loops_mailing_list':
      thread.events.push({
        type: 'add_user_to_loops_mailing_list',
        data: nextStep,
      })

      await hl.createFunctionCall({
        spec: {
          fn: 'add_user_to_loops_mailing_list',
          kwargs: nextStep,
          state: thread,
        },
      })
      return false
    case 'list_loops_mailing_lists':
      thread.events.push({
        type: 'list_loops_mailing_lists',
        data: nextStep,
      })
      if (loops) {
        thread = await appendResult(thread, () => loops.getMailingLists(), 'mailing_lists', redis)
      } else {
        thread.events.push({
          type: 'error',
          data: 'Loops client not initialized',
        })
      }
      return thread
    case 'search_labels':
      thread.events.push({
        type: 'search_labels',
        data: nextStep,
      })
      thread = await appendResult(
        thread,
        () =>
          linearClient.issueLabels({
            filter: {
              name: {
                contains: nextStep.name_contains,
              },
            },
          }),
        `search_labels::${nextStep.name_contains}`,
        redis
      )
      return thread
    default:
      thread.events.push({
        type: 'error',
        data: `you called a tool that is not implemented: ${nextStep.intent}, something is wrong with your internal programming, time to get help`,
      })
      return thread
  }
}

export const handleNextStep = async (
  thread: Thread,
  linearClient: any,
  loops?: any,
  redis?: any
): Promise<void> => {
  const logger = newLogger(thread.id)
  const hl = humanlayer({
    apiKey: HUMANLAYER_API_KEY,
    contactChannel: {
      email: {
        address: thread.initial_email.from_address,
        experimental_subject_line: thread.initial_email.subject
          ? thread.initial_email.subject.startsWith('Re:')
            ? thread.initial_email.subject
            : `Re: ${thread.initial_email.subject}`
          : undefined,
        experimental_in_reply_to_message_id: thread.initial_email.message_id,
        experimental_references_message_id: thread.initial_email.message_id,
      },
    },
  })

  let nextThread: Thread | false = thread

  while (true) {
    const nextStep = await b.DetermineNextStep(threadToPrompt(nextThread))

    logger.log(`==========================`)
    logger.log(`==========================`)
    logger.log(`======= Last Event ========`)
    logger.log(eventToPrompt(thread.events.slice(-1)[0]))
    logger.log(`======= Next Step ========`)
    logger.log(stringifyToYaml(nextStep))
    logger.log(`====== Handling Next Step ========`)

    nextThread = await _handleNextStep(thread, nextStep, hl, linearClient, loops, redis)
    if (!nextThread) {
      logger.log(`nextThread is false, breaking`)
      return
    }
    logger.log(`nextThread is truthy, continuing, last event is ${stringifyToYaml(nextThread.events.slice(-1)[0])}`)
  }
}

export const handleHumanResponse = async (
  thread: Thread,
  payload: any,
  linearClient: any,
  loops?: any,
  redis?: any
): Promise<void> => {
  const humanResponse = payload.event
  if (payload.type === 'human_contact.completed') {
    const humanContact = humanResponse as HumanContact
    thread.events.push({
      type: 'human_response',
      data: humanContact.status?.response!,
    })
    return await handleNextStep(thread, linearClient, loops, redis)
  } else if (payload.type === 'function_call.completed') {
    const functionCall = humanResponse as FunctionCall
    if (!functionCall.status?.approved) {
      thread.events.push({
        type: 'human_response',
        data: `User denied ${functionCall.spec.fn} with feedback: ${
          functionCall.status?.comment || '(No comment provided)'
        }`,
      })
      return await handleNextStep(thread, linearClient, loops, redis)
    } else if (functionCall.spec.fn === 'create_issue') {
      thread = await appendResult(thread, async () => {
        const { issue } = await linearClient.createIssue({
          title: functionCall.spec.kwargs.title,
          description: functionCall.spec.kwargs.description,
          teamId: functionCall.spec.kwargs.team_id,
          assigneeId: functionCall.spec.kwargs.assignee_id,
        });

        return issue;
      }, undefined, redis)

      return await handleNextStep(thread, linearClient, loops, redis)
    } else if (functionCall.spec.fn === 'add_comment') {
      thread = await appendResult(thread, () =>
        linearClient.createComment({
          issueId: functionCall.spec.kwargs.issue_id,
          body: functionCall.spec.kwargs.comment,
        }),
      undefined,
      redis
      )
      return await handleNextStep(thread, linearClient, loops, redis)
    } else if (functionCall.spec.fn === 'add_user_to_loops_mailing_list') {
      if (loops) {
        thread = await appendResult(thread, () =>
          loops.createContact(
            functionCall.spec.kwargs.email,
            {
              firstName: functionCall.spec.kwargs.first_name,
              lastName: functionCall.spec.kwargs.last_name,
            },
            {
              [functionCall.spec.kwargs.mailing_list_id]: true,
            },
          ),
        undefined,
        redis
        )
      } else {
        thread.events.push({
          type: 'error',
          data: 'Loops client not initialized',
        })
      }
      return await handleNextStep(thread, linearClient, loops, redis)
    } else if (functionCall.spec.fn === 'update_issue') {
      thread = await appendResult(thread, () =>
        linearClient.updateIssue(functionCall.spec.kwargs.issue_id, {
          title: functionCall.spec.kwargs.update.title,
          description: functionCall.spec.kwargs.update.description,
          teamId: functionCall.spec.kwargs.update.team_id,
          assigneeId: functionCall.spec.kwargs.update.assignee_id,
          stateId: functionCall.spec.kwargs.update.state_id,
          dueDate: functionCall.spec.kwargs.update.due_date,
          priority: functionCall.spec.kwargs.update.priority,
        }),
      undefined,
      redis
      )
      return await handleNextStep(thread, linearClient, loops, redis)
    } else {
      thread.events.push({
        type: 'error',
        data: `Unknown intent: ${functionCall.spec.fn}`,
      })
      return await handleNextStep(thread, linearClient, loops, redis)
    }
  }

  throw new Error(`Could not determine human response type: ${JSON.stringify(humanResponse)}`)
}
