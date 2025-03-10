# Linear Assistant Architecture

This document outlines the key architectural features of the Linear Assistant TypeScript implementation. It serves as a guide for building similar agents with different tool sets while maintaining the core patterns of context management, webhook routing, BAML prompting, approval flows, human interaction, and external API integration.

## Table of Contents

1. [Overview](#overview)
2. [Core Components](#core-components)
3. [Data Flow](#data-flow)
4. [Context Window Management](#context-window-management)
5. [Webhook Handling](#webhook-handling)
6. [BAML Integration](#baml-integration)
7. [External API Integration](#external-api-integration)
8. [Caching Strategy](#caching-strategy)
9. [Error Handling](#error-handling)
10. [Deployment](#deployment)

## Overview

The Linear Assistant is a TypeScript application that integrates with Linear (project management tool) to help users manage issues via email. It uses HumanLayer for human-in-the-loop approvals and BAML for LLM prompting and structured outputs.

The application follows an event-driven architecture where:
- Inbound emails trigger new threads
- The agent processes the thread and determines next actions
- Actions may require human approval or input
- The agent maintains state across interactions
- Responses are sent back to users via email

## Core Components

### Thread and Event Model

The core data structure is the `Thread`, which contains a series of `Event` objects:

```typescript
interface Thread {
  initial_email: EmailPayload;
  events: Event[];
}

interface Event {
  type: string;
  data: EmailPayload | HumanResponse | CreateIssue | /* other types */ | string;
}
```

This structure allows the agent to maintain a complete history of interactions and decisions.

### Main Loop

The main loop is implemented in the `handleNextStep` function, which:
1. Takes the current thread state
2. Determines the next action using BAML
3. Executes the action or requests human input
4. Updates the thread with results
5. Repeats until completion or human input is needed

```typescript
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
```

### Action Handling

The `_handleNextStep` function is a large switch statement that handles different action types:

```typescript
const _handleNextStep = async (
  thread: Thread,
  nextStep: /* various action types */,
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
    case 'list_teams':
      thread.events.push({
        type: 'list_teams',
        data: nextStep,
      })
      thread = await appendResult(thread, () => linearClient.teams(), 'teams')
      return thread
    // ... other cases
  }
}
```

## Context Window Management

### Building the Context Window

The context window is built by accumulating events in the thread. Each event is formatted into a string representation:

```typescript
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
```

### Context Optimization

To optimize context usage, the application:
1. Caches read-only operations
2. Uses a `SquashResponseContext` function to compress verbose API responses
3. Prefills context with common data at the start of a conversation

```typescript
// Prefill context to avoid wasting round trips
const prefillOps: (ListProjects | ListTeams | ListUsers | ListLabels | ListWorkflowStates | ListLoopsMailingLists)[] = [
  { intent: 'list_projects' } as ListProjects,
  { intent: 'list_teams' } as ListTeams,
  { intent: 'list_users' } as ListUsers,
  { intent: 'list_labels' } as ListLabels,
  { intent: 'list_workflow_states' } as ListWorkflowStates,
];

// Run all prefill operations in parallel
const results = await Promise.all(
  prefillOps.map(op => {
    console.log(`Prefilling context for ${op.intent}`);
    return _handleNextStep(thread, op, _fake_humanlayer);
  })
);
```

## Webhook Handling

### Webhook Routes

The application exposes several webhook endpoints:

```typescript
app.post('/webhook/generic', bodyParser.raw({ type: 'application/json' }), webhookHandler)
app.post('/webhook/new-email-thread', bodyParser.raw({ type: 'application/json' }), webhookHandler)
app.post(
  '/webhook/human-response-on-existing-thread',
  bodyParser.raw({ type: 'application/json' }),
  webhookHandler,
)
```

### Webhook Verification

Webhooks are verified using the Svix library:

```typescript
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
```

### Webhook Payload Handling

Different webhook types are handled by specific functions:

```typescript
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
```

### State Preservation

The application preserves state by:
1. Including the thread state in HumanLayer function calls and human contacts
2. Receiving the state back in webhook responses
3. Continuing processing from where it left off

```typescript
// When sending to HumanLayer
await hl.createFunctionCall({
  spec: {
    fn: 'create_issue',
    kwargs: nextStep.issue,
    state: thread, // Thread state is preserved here
  },
})

// When receiving from HumanLayer
const humanResponse = payload.event
thread = humanResponse.spec.state as Thread // State is restored here
await handleHumanResponse(thread, payload)
```

## BAML Integration

### BAML Structured Outputs

BAML is used to define structured outputs for the agent:

```baml
class ClarificationRequest {
  intent: "request_more_information"
  message: string
}

class CreateIssue {
  intent: "create_issue"
  issue: CreateIssueRequest
}

// ... other structured outputs
```

### BAML Function Calls

The main decision-making function is defined in BAML:

```baml
function DetermineNextStep(
    thread: string 
) -> ClarificationRequest | CreateIssue | ListTeams | ListIssues | ListUsers | DoneForNow | AddComment | SearchIssues | GetIssueComments | ListLabels | ListProjects | AddUserToLoopsMailingList | ListLoopsMailingLists | ListWorkflowStates | UpdateIssue | SearchLabels {
    client CustomGPT4o

    prompt #"
        {{ _.role("system") }}

        You are a helpful assistant that helps the user with their linear issue management.
        You work hard for whoever sent the inbound initial email, and want to do your best
        to help them do their job by carrying out tasks against the linear api.

        // ... rest of prompt ...

        {{ _.role("user") }}

        Linear is a project management tool that helps teams manage their work. 
        You are managing my linear board by creating issues, adding comments, and updating issues.

        // ... rest of prompt ...

        What should the next step be?

        {{ ctx.output_format }}
    "#
}
```

## External API Integration

### Linear API

The application integrates with Linear using the Linear SDK:

```typescript
const linearClient = new LinearClient({ apiKey: process.env.LINEAR_API_KEY })

// Example usage
thread = await appendResult(thread, () => linearClient.teams(), 'teams')
```

### HumanLayer API

HumanLayer is used for human-in-the-loop approvals and contacts:

```typescript
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

// Function call requiring approval
await hl.createFunctionCall({
  spec: {
    fn: 'create_issue',
    kwargs: nextStep.issue,
    state: thread,
  },
})

// Human contact for information
await hl.createHumanContact({
  spec: {
    msg: nextStep.message,
    state: thread,
  },
})
```

## Caching Strategy

The application uses Redis for caching:

```typescript
const redis = new Redis(process.env.REDIS_CACHE_URL || 'redis://redis:6379/1')

// Caching read operations
const appendResult = async (
  thread: Thread,
  fn: () => Promise<any>,
  cacheKey?: string,
): Promise<Thread> => {
  // ... implementation with caching logic
}
```

Key caching features:
1. Read operations are cached for 6 hours
2. Cache keys are based on operation type and parameters
3. Cache hit rates are tracked and logged
4. Squashed responses are also cached to avoid reprocessing

## Error Handling

Error handling is implemented at multiple levels:

1. Function-level try/catch blocks
2. Webhook verification error handling
3. Redis connection error handling
4. Linear API error handling
5. Error events added to the thread for agent awareness

```typescript
try {
  // ... operation
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
```

## Deployment

The application can be deployed using:

1. Docker with the provided Dockerfile and docker-compose.yaml
2. Render with the render.yaml configuration
3. Any Node.js hosting service

```yaml
# docker-compose.yaml example
services:
  linear-assistant:
    stop_grace_period: "1s"
    build:
      context: ./linear-assistant-ts
    env_file:
      - .env
    environment:
      ALLOWED_EMAILS: "dexter@humanlayer.dev,austin@humanlayer.dev,sundeep@humanlayer.dev,dan@humanlayer.dev"
    volumes:
      - ../../humanlayer/agents/linear-assistant-ts/src:/app/src
      - ../../humanlayer/agents/linear-assistant-ts/package.json:/app/package.json
      - ../../humanlayer/agents/linear-assistant-ts/package-lock.json:/app/package-lock.json
      - ../../humanlayer/agents/linear-assistant-ts/tsconfig.json:/app/tsconfig.json
    command:
      - /bin/sh
      - -c
      - |
        npm run dev-reload
    ports:
      - "8000:8000"
```

## Key Architectural Patterns

1. **Event-Driven Architecture**: The system is built around events that trigger actions and updates.
2. **State Management**: Thread state is preserved across interactions, even when control passes to humans.
3. **Structured Decision Making**: BAML provides structured outputs for agent decisions.
4. **Caching for Efficiency**: Read operations are cached to reduce API calls and improve performance.
5. **Human-in-the-Loop**: Critical operations require human approval or input.
6. **Webhook-Based Communication**: Asynchronous communication via webhooks enables long-running processes.
7. **Context Window Optimization**: Various techniques are used to maximize the effective use of context windows.

## Adapting for New Agents

When building a new agent based on this architecture:

1. Define your domain-specific BAML classes and functions
2. Implement the appropriate API clients
3. Adapt the webhook handlers for your use case
4. Modify the context window formatting as needed
5. Adjust caching strategies based on your data patterns
6. Configure the appropriate contact channels in HumanLayer

The core patterns of context management, webhook routing, and human-in-the-loop approvals can remain largely unchanged.
