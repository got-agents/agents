import express, { Express, Request, Response } from 'express';
import { b, EmailPayload, Thread, Event, ClarificationRequest, AddComment, ListProjects, ListLabels, GetIssueComments, SearchIssues, CreateIssue, ListTeams, ListIssues, ListUsers, DoneForNow } from './baml_client';
import { EmailContactChannel, FunctionCall, HumanContact, humanlayer, HumanLayer } from 'humanlayer';
import { LinearClient, LinearFetch, User } from "@linear/sdk";

import * as yaml from 'js-yaml';

const linearClient = new LinearClient({ apiKey: process.env.LINEAR_API_KEY });

function stringifyToYaml(obj: any): string {
  // Custom replacer function to ignore functions
  const replacer = (key: string, value: any) => {
    if (typeof value === 'function') {
      return undefined; // Ignore functions
    }
    return value;
  };

  // Convert object to a plain JavaScript object, ignoring functions
  const plainObj = JSON.parse(JSON.stringify(obj, replacer));

  // Convert to YAML
  return yaml.dump(plainObj, {
    skipInvalid: true, // Skip invalid YAML elements
    noRefs: true, // Don't output YAML references
  });
}

const app: Express = express();
const port = process.env.PORT || 8000;

app.use(express.json());

// accumulators are one honking great idea
const eventToPrompt = (event: Event) => {
  switch (event.type) {
    case 'email_received':
      const email = event.data as EmailPayload;
      return `<${event.type}>
            From: ${email.from_address}
            To: ${email.to_address}
            Subject: ${email.subject}
            Body: ${email.body}
            Previous Thread: ${stringifyToYaml(email.previous_thread)}
</${event.type}>
        `
    default:
      const data = typeof event.data !== 'string' ? stringifyToYaml(event.data) : event.data;
      return `<${event.type}>
          ${data}
</${event.type}>
      `
  }
}

const threadToPrompt = (thread: Thread) => {
  return thread.events.map(eventToPrompt).join('\n\n');
}

const lastEventToResultType: Record<string, Event["type"]> = {
  'create_issue': 'issue_create_result',
  'add_comment': 'add_comment_result',
  'list_teams': 'list_teams_result',
  'list_users': 'list_users_result',
  'list_issues': 'list_issues_result',
  'list_labels': 'list_labels_result',
  'get_issue_comments': 'get_issue_comments_result',
  'search_issues': 'search_issues_result',
  'list_projects': 'list_projects_result',
}

const appendResult = async (thread: Thread, fn: () => Promise<any>): Promise<Thread> => {
  const lastEvent: Event = thread.events.slice(-1)[0];
  const responseType: Event["type"] = lastEventToResultType[lastEvent.type];
  if (!responseType) {
    throw new Error(`No response type found for ${lastEvent.type}`);
  }
  try {
    const result = await fn();
    const event = await b.SquashResponseContext(
      threadToPrompt(thread),
      stringifyToYaml(result)
    )
    thread.events.push({
      type: responseType,
      data: event
    })
  } catch (e) {
    console.error(e)
    const errorEvent = await b.SquashResponseContext(
      threadToPrompt(thread),
      `error running ${thread.events.slice(-1)[0].type}: ${e}`
    )
    thread.events.push({
      type: 'error',
      data: errorEvent
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
  nextStep: ClarificationRequest | CreateIssue | ListTeams | ListIssues | ListUsers | DoneForNow
    | AddComment | SearchIssues | GetIssueComments | ListLabels | ListProjects,
  hl: HumanLayer,
): Promise<Thread | false> => {
  switch (nextStep.intent) {
    case 'done_for_now':
      thread.events.push({
        type: 'done_for_now',
        data: nextStep
      })
      await hl.createHumanContact({
        spec: {
          msg: nextStep.message,
          state: thread
        }
      })
      return false
    case 'request_more_information':
      thread.events.push({
        type: 'request_more_information',
        data: nextStep
      })
      await hl.createHumanContact({
        spec: {
          msg: nextStep.message,
          state: thread
        }
      })
      console.log(`thread sent to humanlayer`)
      return false
    case 'create_issue':
      thread.events.push({
        type: 'create_issue',
        data: nextStep
      })
      await hl.createFunctionCall({
        spec: {
          fn: 'create_issue',
          kwargs: nextStep.issue,
          state: thread
        }
      })
      console.log(`thread sent to humanlayer`)
      return false
    case 'add_comment':
      thread.events.push({
        type: 'add_comment',
        data: nextStep
      })
      await hl.createFunctionCall({
        spec: {
          fn: 'add_comment',
          kwargs: {
            issue_id: nextStep.issue_id,
            comment: nextStep.comment,
            view_issue_url: nextStep.view_issue_url
          },
          state: thread
        }
      })
      return false
    case 'list_teams':
      thread.events.push({
        type: 'list_teams',
        data: nextStep
      })
      thread = await appendResult(thread, () => linearClient.teams())
      return thread
    case 'list_users':
      thread.events.push({
        type: 'list_users',
        data: nextStep
      })
      thread = await appendResult(thread, () => linearClient.users())
      return thread
    case 'list_projects':
      thread.events.push({
        type: 'list_projects',
        data: nextStep
      })
      thread = await appendResult(thread, () => linearClient.projects())
      return thread
    case 'search_issues':
      thread.events.push({
        type: 'search_issues',
        data: nextStep
      })
      thread = await appendResult(thread, () => linearClient.searchIssues(nextStep.query))
      return thread
    case 'list_issues':
      thread.events.push({
        type: 'list_issues',
        data: nextStep
      })
      thread = await appendResult(thread, () => linearClient.issues({
        filter: {
          title: nextStep.filter?.title,
          description: nextStep.filter?.description,
          project: {
            id: {
              eq: nextStep.filter?.projectId,
            }
          },
          labels: {
            id: {
              in: nextStep.filter?.labelIds,
            }
          },
          state: {
            id: {
              eq: nextStep.filter?.stateId,
            }
          },
          createdAt: {
            gte: nextStep.filter?.createdAfter,
            lte: nextStep.filter?.createdBefore,
          },
          updatedAt: {
            gte: nextStep.filter?.updatedAfter,
            lte: nextStep.filter?.updatedBefore,
          }
        },
        first: nextStep.first,
        last: nextStep.last,
        after: nextStep.after,
        before: nextStep.before,
      }))
      return thread
    case 'list_labels':
      thread.events.push({
        type: 'list_labels',
        data: nextStep
      })
      thread = await appendResult(thread, () => linearClient.issueLabels())
      return thread
    case 'get_issue_comments':
      thread.events.push({
        type: 'get_issue_comments',
        data: nextStep
      })
      thread = await appendResult(thread, async () => (await linearClient.issue(nextStep.issue_id)).comments())
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
        experimental_subject_line: thread.initial_email.subject ? (thread.initial_email.subject.startsWith('Re:') ? thread.initial_email.subject : `Re: ${thread.initial_email.subject}`) : undefined,
        experimental_in_reply_to_message_id: thread.initial_email.message_id,
        experimental_references_message_id: thread.initial_email.message_id,
      }
    }
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

const handleHumanResponse = async (thread: Thread, humanResponse: FunctionCall | HumanContact): Promise<void> => {
  if ("msg" in humanResponse.spec) {
    // its a human contact, append the human response to the thread
    const humanContact = humanResponse as HumanContact;
    thread.events.push({
      type: 'human_response',
      data: humanContact.status?.response!
    })
    return await handleNextStep(thread);
  } else if ("fn" in humanResponse.spec) {
    // its a function call
    const functionCall = humanResponse as FunctionCall;
    // check if it was approved
    if (!functionCall.status?.approved) {
      // denied? push the feedback to the thread and let the llm continue 
      thread.events.push({
        type: 'human_response',
        data: `User denied ${functionCall.spec.fn} with feedback: ${functionCall.status?.comment || '(No comment provided)'}`
      });
      return await handleNextStep(thread);
    } else if (functionCall.spec.fn === 'create_issue') {
      // create_issue approved, create it and tell the llm what happened
      thread = await appendResult(thread, () => linearClient.createIssue({
        title: functionCall.spec.kwargs.title,
        description: functionCall.spec.kwargs.description,
        teamId: functionCall.spec.kwargs.team_id,
        assigneeId: functionCall.spec.kwargs.assignee_id,
      }))
      return await handleNextStep(thread);
    } else if (functionCall.spec.fn === 'add_comment') {
      // add_comment approved, create it and tell the llm what happened
      thread = await appendResult(thread, () => linearClient.createComment({
        issueId: functionCall.spec.kwargs.issue_id,
        body: functionCall.spec.kwargs.comment
      }))
      return await handleNextStep(thread);
    } else {
      // unknown function name, push an error to the thread and let the llm continue
      thread.events.push({
        type: 'error',
        data: `Unknown function name: ${functionCall.spec.fn}`
      })
      return await handleNextStep(thread);
    }
  }

  throw new Error(`Could not determine human response type: ${JSON.stringify(humanResponse)}`)
}

app.post('/webhook/new-email-thread', async (req: Request, res: Response) => {
  const body: EmailPayload = req.body;
  let thread: Thread = {
    initial_email: body,
    events: [
      {
        type: 'email_received',
        data: body
      }
    ]
  }

  // prefill context always, don't waste tokens on this
  const _fake_humanlayer = undefined as any // wont need this yet
  thread = await _handleNextStep(thread, { intent: 'list_projects' }, _fake_humanlayer) as Thread
  thread = await _handleNextStep(thread, { intent: 'list_teams' }, _fake_humanlayer) as Thread
  thread = await _handleNextStep(thread, { intent: 'list_users' }, _fake_humanlayer) as Thread
  thread = await _handleNextStep(thread, { intent: 'list_labels' }, _fake_humanlayer) as Thread

  // now pass it to the llm
  try {
    await handleNextStep(thread)
    res.json({ status: 'ok' });
  } catch (e) {
    console.error(e)
    res.json({ status: 'error', error: e });
  }
});


app.post('/webhook/human-response-on-existing-thread', async (req: Request, res: Response) => {
  const humanResponse = req.body;

  if (!humanResponse.spec.state) {
    throw new Error('state is required');
  }

  let thread: Thread = humanResponse.spec.state;
  console.log(`human_response received: ${JSON.stringify(humanResponse)}`);

  try {
    await handleHumanResponse(thread, humanResponse);
    res.json({ status: 'ok' });
  } catch (e) {
    console.error(e)
    res.status(500)
    res.json({ status: 'error', error: e });
  }
});

// Basic health check endpoint
app.get('/health', async (req: Request, res: Response) => {
  const nextStep = await b.DetermineNextStep('<inbound_email>make a ticket for austin to stock the fridges</inbound_email>')

  switch (nextStep.intent) {
    case 'create_issue':
      res.json({ status: 'ok' });
      break;
    default:
      res.json({ status: 'ok' });
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
