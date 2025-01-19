import { LinearClient } from '@linear/sdk'
import express, { Express, Request, Response } from 'express'
import { FunctionCall, HumanContact, humanlayer, HumanLayer } from 'humanlayer'
import Redis from 'ioredis'
import { LoopsClient } from 'loops'
import {
  AddComment,
  AddUserToLoopsMailingList,
  b,
  ClarificationRequest,
  CreateIssue,
  DoneForNow,
  EmailPayload,
  Event,
  GetIssueComments,
  ListIssues,
  ListLabels,
  ListLoopsMailingLists,
  ListProjects,
  ListTeams,
  ListUsers,
  ListWorkflowStates,
  SearchIssues,
  Thread,
  UpdateIssue,
} from './baml_client'

import * as yaml from 'js-yaml'

const linearClient = new LinearClient({ apiKey: process.env.LINEAR_API_KEY })
const loops = new LoopsClient(process.env.LOOPS_API_KEY!)
const redis = new Redis(process.env.REDIS_CACHE_URL || 'redis://redis:6379/1')
const stateMode: string = process.env.STATE_MODE || 'remote'

if (stateMode !== 'remote' && stateMode !== 'cache') {
  throw new Error('STATE_MODE must be either "remote" or "cache"')
}

const STATE_MODE: 'remote' | 'cache' = stateMode as 'remote' | 'cache'

redis.on('error', err => {
  console.error('Redis connection error:', err)
})

redis.on('connect', () => {
  console.log('Connected to Redis')
})
const CACHE_TTL = 60 * 60 * 6 // 6 hours in seconds
const debug: boolean = !!process.env.DEBUG

function stringifyToYaml(obj: any): string {
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

const app: Express = express()
const port = process.env.PORT || 8000

app.use(express.json({ limit: '50mb' }))

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
}

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
      data: `No response type found for ${lastEvent.type} - something is wrong with your internal programming, time to get help`,
    })
    return thread
  }
  try {
    let result
    let squashedEvent
    if (cacheKey) {
      const [cachedResult, cachedSquash] = await Promise.all([
        redis.get(cacheKey),
        redis.get(`squash_${cacheKey}_${threadToPrompt(thread)}`),
      ])

      if (cachedResult && cachedSquash) {
        result = JSON.parse(cachedResult)
        squashedEvent = cachedSquash
      } else {
        result = await fn()
        squashedEvent = await b.SquashResponseContext(threadToPrompt(thread), stringifyToYaml(result))
        await Promise.all([
          redis.setex(cacheKey, CACHE_TTL, JSON.stringify(result)),
          redis.setex(`squash_${cacheKey}_${threadToPrompt(thread)}`, CACHE_TTL, squashedEvent),
        ])
      }
    } else {
      result = await fn()
      squashedEvent = await b.SquashResponseContext(threadToPrompt(thread), stringifyToYaml(result))
    }
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
    | UpdateIssue,
  hl: HumanLayer,
): Promise<Thread | false> => {
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
    case 'create_issue':
      thread.events.push({
        type: 'create_issue',
        data: nextStep,
      })
      await hl.createFunctionCall({
        spec: {
          fn: 'create_issue',
          kwargs: nextStep.issue,
          state: thread,
        },
      })
      console.log(`thread sent to humanlayer`)
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
      thread = await appendResult(thread, () => linearClient.teams(), 'teams')
      return thread
    case 'list_users':
      thread.events.push({
        type: 'list_users',
        data: nextStep,
      })
      thread = await appendResult(thread, () => linearClient.users(), 'users')
      return thread
    case 'list_projects':
      thread.events.push({
        type: 'list_projects',
        data: nextStep,
      })
      thread = await appendResult(thread, () => linearClient.projects(), 'projects')
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
      thread = await appendResult(thread, () => loops.getMailingLists(), 'mailing_lists')
      return thread
    default:
      throw new Error('Not implemented')
  }
}

// just keep folding
const handleNextStep = async (thread: Thread): Promise<void> => {
  const hl = humanlayer({
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

const handleHumanResponse = async (
  thread: Thread,
  humanResponse: FunctionCall | HumanContact,
): Promise<void> => {
  if ('msg' in humanResponse.spec) {
    // its a human contact, append the human response to the thread
    const humanContact = humanResponse as HumanContact
    thread.events.push({
      type: 'human_response',
      data: humanContact.status?.response!,
    })
    return await handleNextStep(thread)
  } else if ('fn' in humanResponse.spec) {
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
    } else if (functionCall.spec.fn === 'create_issue') {
      // create_issue approved, create it and tell the llm what happened
      thread = await appendResult(thread, () =>
        linearClient.createIssue({
          title: functionCall.spec.kwargs.title,
          description: functionCall.spec.kwargs.description,
          teamId: functionCall.spec.kwargs.team_id,
          assigneeId: functionCall.spec.kwargs.assignee_id,
        }),
      )
      return await handleNextStep(thread)
    } else if (functionCall.spec.fn === 'add_comment') {
      // add_comment approved, create it and tell the llm what happened
      thread = await appendResult(thread, () =>
        linearClient.createComment({
          issueId: functionCall.spec.kwargs.issue_id,
          body: functionCall.spec.kwargs.comment,
        }),
      )
      return await handleNextStep(thread)
    } else if (functionCall.spec.fn === 'add_user_to_loops_mailing_list') {
      // add to mailing list approved, add the contact and then tell the llm what happened
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
      )
      return await handleNextStep(thread)
    } else if (functionCall.spec.fn === 'update_issue') {
      // update_issue approved, update it and tell the llm what happened
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
      )
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

const getAllowedEmails = (): Set<string> => {
  const allowedEmails = process.env.ALLOWED_EMAILS || ''
  return new Set(
    allowedEmails
      .split(',')
      .map(email => email.trim())
      .filter(Boolean),
  )
}

app.post('/webhook/new-email-thread', (req: Request, res: Response) => {
  if (req.body.is_test || req.body.event.from_address === 'overworked-admin@coolcompany.com') {
    console.log('test email received, skipping')
    res.json({ status: 'ok', intent: 'test' })
    return
  }

  const allowedEmails = getAllowedEmails()
  if (allowedEmails.size > 0 && !allowedEmails.has(req.body.event.from_address)) {
    console.log(`email from non-allowed sender ${req.body.event.from_address}, skipping`)
    res.json({ status: 'ok', intent: 'unauthorized' })
    return
  }

  console.log(`new email received from ${req.body.event.from_address}`)

  // Return immediately
  res.json({ status: 'ok' })

  // Process asynchronously
  Promise.resolve().then(async () => {
    const body: EmailPayload = req.body.event
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
      const _fake_humanlayer = undefined as any // wont need this yet, these are all read-only
      console.log('prefilling projects')
      thread = (await _handleNextStep(thread, { intent: 'list_projects' }, _fake_humanlayer)) as Thread
      console.log('prefilling teams')
      thread = (await _handleNextStep(thread, { intent: 'list_teams' }, _fake_humanlayer)) as Thread
      console.log('prefilling users')
      thread = (await _handleNextStep(thread, { intent: 'list_users' }, _fake_humanlayer)) as Thread
      console.log('prefilling labels')
      thread = (await _handleNextStep(thread, { intent: 'list_labels' }, _fake_humanlayer)) as Thread
      console.log('prefilling workflow states')
      thread = (await _handleNextStep(
        thread,
        { intent: 'list_workflow_states' },
        _fake_humanlayer,
      )) as Thread
      console.log('prefilling mailing lists')
      thread = (await _handleNextStep(
        thread,
        { intent: 'list_loops_mailing_lists' },
        _fake_humanlayer,
      )) as Thread

      // now pass it to the llm
      await handleNextStep(thread)
    } catch (e) {
      console.error('Error processing new email thread:', e)
    }
  })
})

app.post('/webhook/human-response-on-existing-thread', (req: Request, res: Response) => {
  const humanResponse = req.body
  if (debug) {
    console.log(`${JSON.stringify(humanResponse)}`)
  }

  if (!humanResponse.spec.state) {
    console.error('received human response without state')
    res.status(500)
    res.json({ status: 'error', error: 'state is required' })
    return
  }

  // Return immediately
  res.json({ status: 'ok' })

  // Process asynchronously
  Promise.resolve().then(async () => {
    try {
      let thread: Thread = humanResponse.spec.state
      console.log(`human_response received: ${JSON.stringify(humanResponse)}`)
      await handleHumanResponse(thread, humanResponse)
    } catch (e) {
      console.error('Error processing human response:', e)
    }
  })
})

// Basic health check endpoint
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

app.listen(port, () => {
  console.log(process.env.HUMANLAYER_API_BASE)
  console.log(`Server running at http://localhost:${port}`)
})
