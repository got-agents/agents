# Agents the Hard Way: 12-Factor Agents

In the rapidly evolving landscape of AI agents, we've been building production-grade systems that tackle real business problems. Through this journey, we've developed an architecture pattern we call "12-Factor Agents" – inspired by Heroku's [12-Factor App methodology](https://12factor.net/), but tailored specifically for LLM-powered agents.

This approach isn't about using the latest AutoGPT framework or agent orchestration platform. It's about building agents from first principles, with complete control over every aspect of their operation. We call it "agents the hard way" because it requires more upfront engineering effort, but the payoff is worth it: robust, maintainable, and truly effective agents.

Let's dive into the 12 factors that define this methodology.

## 1. Natural Language → Tool Calls

At the core of our approach is a simple pattern: convert natural language to structured tool calls. Instead of building complex chains of prompts and hoping for the best, we focus on teaching our LLMs to output structured data that our systems can reliably act upon.

```typescript
// The LLM takes natural language and returns a structured tool call
const nextStep = await b.DetermineNextStep(threadToPrompt(thread))

// Handle the structured output based on its intent
switch (nextStep.intent) {
  case 'create_issue':
    // Code to create an issue
    break;
  case 'request_more_information':
    // Code to ask the user for more info
    break;
}
```

This pattern creates a clean interface between the LLM's reasoning and your application logic.

## 2. Small, Focused Agents

Rather than building monolithic agents that try to do everything, build small, focused agents that do one thing well. Each agent should have a clear responsibility boundary. This makes testing, maintenance, and improvement much simpler.

Our Linear Assistant handles email-based issue management in Linear. It doesn't try to also manage GitHub issues, calendar scheduling, or data analysis. This focus allows it to excel at its specific task.

## 3. Compact Errors into Context Window

When something goes wrong, don't hide it from your agent. Compact the error information and include it in the context window:

```typescript
try {
  // Operation that might fail
} catch (e) {
  console.error(e)
  thread.events.push({
    type: 'error',
    data: `error running ${thread.events.slice(-1)[0].type}: ${e}`,
  })
}
```

This allows your agent to learn from mistakes and adapt its approach in real-time, just like a human would.

## 4. Use Tools for Human Interaction

Human interaction should be treated as just another tool call. By modeling human input requests consistently with other tool calls, you create a uniform pattern throughout your codebase:

```typescript
// Request information from a human
await hl.createHumanContact({
  spec: {
    msg: nextStep.message,
    state: thread,
  },
})

// Request approval for an action
await hl.createFunctionCall({
  spec: {
    fn: 'create_issue',
    kwargs: nextStep.issue,
    state: thread,
  },
})
```

This approach creates a consistent pattern for all interactions, whether they're with APIs or humans.

## 5. Tools Are Just Structured Output

Tools don't need to be complex. At their core, they're just structured output from your LLM:

```baml
class CreateIssue {
  intent: "create_issue"
  issue: CreateIssueRequest
}

class RequestMoreInformation {
  intent: "request_more_information"
  message: string
}
```

By defining clear structures for your tools, you create a contract between your LLM and your code.

## 6. Own Your Prompts

Don't outsource your prompt engineering to a framework. Own your prompts and treat them as first-class citizens in your codebase:

```baml
function DetermineNextStep(thread: string) -> /* various tool types */ {
    client CustomGPT4o

    prompt #"
        {{ _.role("system") }}

        You are a helpful assistant that helps the user with their linear issue management.
        You work hard for whoever sent the inbound initial email, and want to do your best
        to help them do their job by carrying out tasks against the linear api.

        // ... rest of prompt ...

        {{ _.role("user") }}

        // ... user-specific instructions ...

        {{ thread }}

        What should the next step be?

        {{ ctx.output_format }}
    "#
}
```

By maintaining direct control over your prompts, you can iterate and improve them based on real-world performance.

## 7. Own How You Build Context

Don't be constrained by the standard message-based context building of most frameworks. Build your context however makes sense for your application:

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
    // ... other event types
  }
}

const threadToPrompt = (thread: Thread) => {
  return thread.events.map(eventToPrompt).join('\n\n')
}
```

This approach gives you complete control over the information density and format of your context window.

## 8. Own Your Control Flow

Don't let frameworks dictate your application's flow. Build your own control structures that make sense for your specific use case:

```typescript
const handleNextStep = async (thread: Thread): Promise<void> => {
  let nextThread: Thread | false = thread

  while (true) {
    const nextStep = await b.DetermineNextStep(threadToPrompt(nextThread))
    
    nextThread = await _handleNextStep(thread, nextStep, hl)
    if (!nextThread) {
      break  // Exit when we need human input or the task is complete
    }
  }
}
```

This pattern allows you to interrupt and resume your agent's flow as needed, creating more natural conversations and workflows.

## 9. Simplify with Context Window State

Keep your state management simple by storing all state in the context window:

```typescript
// When sending to HumanLayer
await hl.createFunctionCall({
  spec: {
    fn: 'create_issue',
    kwargs: nextStep.issue,
    state: thread,  // The entire thread state is preserved here
  },
})

// When receiving from HumanLayer
const humanResponse = payload.event
thread = humanResponse.spec.state as Thread  // State is restored here
```

This approach eliminates the need for complex state management systems, making your agent more reliable and easier to debug.

## 10. APIs to Kick Off and Resume Agents

Design clear APIs for starting new agent threads and resuming existing ones:

```typescript
// New email handler to start a thread
const newEmailThreadHandler = async (payload: EmailWebhookPayload, res: Response) => {
  // Initialize a new thread
  let thread: Thread = {
    initial_email: payload.event,
    events: [
      {
        type: 'email_received',
        data: payload.event,
      },
    ],
  }
  
  // Start processing
  await handleNextStep(thread)
}

// Handler for human responses to resume a thread
const callCompletedHandler = async (payload: HumanContactWebhookPayload | FunctionCallWebhookPayload, res: Response) => {
  // Resume an existing thread
  let thread = payload.event.spec.state as Thread
  await handleHumanResponse(thread, payload)
}
```

These APIs create clean boundaries for thread lifecycle management.

## 11. Trigger Agents from Anywhere

Meet users where they are by designing your agents to be triggered from various channels:

```typescript
// Handle webhooks from different sources
const webhookHandler = (req: Request, res: Response) => {
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

This flexibility allows your agents to integrate seamlessly with email, Slack, SMS, or any other communication channel.

## 12. Make Your Agent a Stateless Reducer

Design your agent as a stateless reducer that takes the current state and an event, then returns a new state:

```typescript
// The agent is a pure function: (state, event) => new state
const _handleNextStep = async (
  thread: Thread,  // Current state
  nextStep: Action,  // Event
  hl: HumanLayer,
): Promise<Thread | false> => {
  // Create a new state based on the current state and event
  switch (nextStep.intent) {
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

This functional approach makes your agent easier to test, debug, and scale.

## Bringing It All Together

By following these 12 factors, we've built agents that are robust, maintainable, and effective at solving real business problems. The Linear Assistant we've created can:

1. Receive emails requesting Linear issue creation or updates
2. Parse and understand complex natural language requests
3. Take appropriate actions through the Linear API
4. Request human approval for sensitive operations
5. Ask for clarification when needed
6. Maintain context across multiple interactions
7. Respond naturally to users via email

And it does all this through a simple, clear architecture that our team can easily maintain and extend.

## Conclusion

Building agents "the hard way" might seem like more work initially, but the benefits are substantial. You gain complete control over your agent's behavior, eliminating the black-box problems that plague many framework-based approaches.

The 12-Factor Agent methodology creates a clear separation of concerns:
- LLMs handle natural language understanding and decision-making
- Your code handles structured actions and external integrations
- Humans provide oversight and handle edge cases

This separation allows each part of the system to do what it does best, creating agents that are truly useful rather than merely impressive demos.

As we continue to evolve this architecture, we're finding that these principles scale well across different domains and use cases. Whether you're building customer service agents, internal tools, or complex workflow automation, the 12-Factor approach provides a solid foundation.
