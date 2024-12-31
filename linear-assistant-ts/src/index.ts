import express, { Express, Request, Response } from 'express';
import { b, EmailPayload, Thread, Event, ClarificationRequest } from './baml_client';
import { EmailContactChannel, CloudHumanContactStore, HumanLayerCloudConnection, HumanLayer } from 'humanlayer';

const app: Express = express();
const port = process.env.PORT || 8000;

app.use(express.json());

const eventToPrompt = (event: Event) => {
  switch (event.type) {
    case 'email_received':
      const email = event.data as EmailPayload;
      return `<${event.type}>
            From: ${email.from_address}
            To: ${email.to_address}
            Subject: ${email.subject}
            Body: ${email.body}
            Previous Thread: ${[email.previous_thread]}
</${event.type}>
        `
    case 'human_response':
      const humanResponse = event.data as any;
      return `<${event.type}>
            Message: ${humanResponse.message}
</${event.type}>
        `
    case 'create_issue':
      const createIssue = event.data as any;
      return `<${event.type}>
            Title: ${createIssue.issue.title}
            Description: ${createIssue.issue.description}
            Team ID: ${createIssue.issue.team_id}
            URL: ${createIssue.issue.url || 'Not created yet'}
</${event.type}>
        `
    case 'list_users':
      const listUsers = event.data as any;
      return `<${event.type}>
            Team ID: ${listUsers.team_id || 'All Teams'}
</${event.type}>
        `
    case 'list_labels':
      const listLabels = event.data as any;
      return `<${event.type}>
            Team ID: ${listLabels.team_id || 'All Teams'}
</${event.type}>
        `
    default:
      return `<${event.type}>
          ${JSON.stringify(event.data)}
</${event.type}>
      `
  }
}

const threadToPrompt = (thread: Thread) => {
  return thread.events.map(eventToPrompt).join('\n\n');
}

const handleNextStep = async (thread: Thread) => {
  const hl = new HumanLayer({
    contactChannel: {
      email: {
        address: thread.initial_email.from_address,
        experimental_subject_line: thread.initial_email.subject ? (thread.initial_email.subject.startsWith('Re:') ? thread.initial_email.subject : `Re: ${thread.initial_email.subject}`) : undefined,
        experimental_in_reply_to_message_id: thread.initial_email.message_id,
        experimental_references_message_id: thread.initial_email.message_id,
      } as EmailContactChannel
    }
  })

  outer:
  while (true) {
    const nextStep = await b.DetermineNextStep(threadToPrompt(thread))
    console.log(nextStep)
    switch (nextStep.intent) {
      case 'request_more_information':
        await hl.createHumanContact({
          spec: {
            msg: nextStep.message,
            state: thread
          }
        })
        thread.events.push({
          type: 'human_response',
          data: nextStep
        })
        break outer
      case 'create_issue':
        thread.events.push({
          type: 'create_issue',
          data: nextStep
        })
        thread.events.push({
          type: 'error',
          data: "it failed, try something else"
        })
        continue
      default:
        throw new Error('Not implemented')
    }
  }
}

app.post('/webhook/new-email-thread', async (req: Request, res: Response) => {
  const body: EmailPayload = req.body;
  const thread: Thread = {
    initial_email: body,
    events: [
      {
        type: 'email_received',
        data: body
      }
    ]
  }
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

  const thread: Thread = humanResponse.spec.state;
  console.log(`human_response received: ${JSON.stringify(humanResponse)}`);

  if ('status' in humanResponse && humanResponse.status?.response) {
    thread.events.push({
      type: 'human_response',
      data: {
        event_type: 'human_response',
        message: humanResponse.status.response,
      }
    });
    await handleNextStep(thread);
  } else if ('spec' in humanResponse && humanResponse.spec.fn === 'create_issue') {
    if (!humanResponse.status?.approved) {
      thread.events.push({
        type: 'human_response',
        data: `User denied create_issue with feedback: ${humanResponse.status?.comment || 'No comment provided'}`
      });
      await handleNextStep(thread);
    } else {
      thread.events.push({
        type: 'error',
        data: "Linear integration not implemented yet"
      });
      await handleNextStep(thread);
    }
  }

  res.json({ status: 'ok' });
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
