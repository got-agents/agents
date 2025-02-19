import { LinearClient } from '@linear/sdk'
import express, { Express, Request, Response } from 'express'
import { FunctionCall, HumanContact, humanlayer, HumanLayer } from 'humanlayer'
import Redis from 'ioredis'
import { LoopsClient } from 'loops'
import { Webhook } from 'svix'
import bodyParser from 'body-parser'
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
  SearchLabels,
} from './baml_client'

import * as yaml from 'js-yaml'
import { createHash } from 'crypto'

const linearClient = new LinearClient({ apiKey: process.env.LINEAR_API_KEY })
const loops = new LoopsClient(process.env.LOOPS_API_KEY!)
const redis = new Redis(process.env.REDIS_CACHE_URL || 'redis://redis:6379/1')

redis.on('error', err => {
  console.error('Redis connection error:', err)
})

redis.on('connect', () => {
  console.log('Connected to Redis')
})
const CACHE_TTL = 60 * 60 * 120 // 120 hours in seconds
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
  search_labels: 'search_labels_result',
}

// Add after Redis initialization
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

// Log cache stats every minute
setInterval(() => {
  const hitRate = cacheStats.getHitRate()
  console.log(
    `Cache stats - Hits: ${cacheStats.hits}, Misses: ${cacheStats.misses}, Hit Rate: ${hitRate.toFixed(
      2,
    )}%`,
  )
  cacheStats.reset() // Reset counters after logging
}, 60000) // 60000ms = 1 minute

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
        redis.get(
          `squash_${cacheKey}_${createHash('sha256').update(threadToPrompt(thread)).digest('hex')}`,
        ),
      ])

      if (cachedResult && cachedSquash) {
        cacheStats.hits++
        result = JSON.parse(cachedResult)
        squashedEvent = cachedSquash
      } else if (cachedResult) {
        cacheStats.hits++
        result = JSON.parse(cachedResult)
        squashedEvent = await b.SquashResponseContext(threadToPrompt(thread), stringifyToYaml(result))
      } else {
        cacheStats.misses++
        result = await fn()
        squashedEvent = await b.SquashResponseContext(threadToPrompt(thread), stringifyToYaml(result))
        await Promise.all([
          redis.setex(cacheKey, CACHE_TTL, JSON.stringify(result)),
          redis.setex(
            `squash_${cacheKey}_${createHash('sha256').update(threadToPrompt(thread)).digest('hex')}`,
            CACHE_TTL,
            squashedEvent,
          ),
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
    | UpdateIssue
    | SearchLabels,
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
  payload: HumanContactWebhookPayload | FunctionCallWebhookPayload,
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
    } else if (functionCall.spec.fn === 'create_issue') {
      // create_issue approved, create it and tell the llm what happened
      thread = await appendResult(thread, async () => {
        // Don't be deceived, this single line is actually two calls to the Linear API.
        // One to create an issue and one to populate the issue contents.
        const { issue } = await linearClient.createIssue({
          title: functionCall.spec.kwargs.title,
          description: functionCall.spec.kwargs.description,
          teamId: functionCall.spec.kwargs.team_id,
          assigneeId: functionCall.spec.kwargs.assignee_id,
        });

        return issue;
      })

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

// vendor these in, should be exported from humanlayer but they're not yet
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
      const _fake_humanlayer = undefined as any // wont need this yet, these are all read-only
      
      // Create array of prefill operations with proper types
      const prefillOps: (ListProjects | ListTeams | ListUsers | ListLabels | ListWorkflowStates | ListLoopsMailingLists)[] = [
        { intent: 'list_projects' } as ListProjects,
        { intent: 'list_teams' } as ListTeams,
        { intent: 'list_users' } as ListUsers,
        { intent: 'list_labels' } as ListLabels,
        { intent: 'list_workflow_states' } as ListWorkflowStates,
      ];

      if (process.env.LOOPS_API_KEY) {
        prefillOps.push({ intent: 'list_loops_mailing_lists' } as ListLoopsMailingLists);
      }

      // Run all prefill operations in parallel
      const results = await Promise.all(
        prefillOps.map(op => {
          console.log(`Prefilling context for ${op.intent}`);
          return _handleNextStep(thread, op, _fake_humanlayer);
        })
      );

      // Merge all events from parallel operations into thread
      results.forEach(result => {
        if (result) {
          const resultThread = result as Thread;
          // Only copy the last two events from each result (the request and response)
          const lastTwoEvents = resultThread.events.slice(-2);
          thread.events.push(...lastTwoEvents);
        }
      });

      // now pass it to the llm
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

  switch (payload.type) {
    case 'agent_email.received':
      return newEmailThreadHandler(payload, res)
    case 'human_contact.completed':
      return callCompletedHandler(payload, res)
    case 'function_call.completed':
      return callCompletedHandler(payload, res)
  }
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

app.listen(port, async () => {
  const apiBase = process.env.HUMANLAYER_API_BASE || 'https://api.humanlayer.dev/humanlayer/v1'
  console.log(`humanlayer api base: ${apiBase}`)

  console.log(`fetching project from ${apiBase}/project`)
  const project = await fetch(`${apiBase}/project`, {
    headers: {
      Authorization: `Bearer ${process.env.HUMANLAYER_API_KEY}`,
    },
  })
  console.log(await project.json())

  console.log(`Server running at http://localhost:${port}`)
})

app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Linear Assistant is running',
  })
})
