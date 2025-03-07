# How We Got Here: The Evolution of AI Agents

The journey to our current approach to AI agents didn't happen overnight. It evolved through a series of experiments, failures, and insights that gradually shaped our thinking about how to build robust, production-grade agent systems.

## The Early Days: Chasing the AutoGPT Dream

When we first started building AI agents in early 2023, we were captivated by the promise of fully autonomous systems. The viral success of AutoGPT had everyone imagining agents that could independently tackle complex tasks with minimal human oversight. We jumped on this bandwagon, experimenting with various frameworks that promised to deliver this autonomous future.

Our first attempts were built on top of LangChain, using its agent frameworks to create systems that could reason about tasks and execute them. While these worked well for demos and simple use cases, we quickly hit limitations when trying to deploy them in production:

1. **Reliability issues**: The agents would sometimes get stuck in loops, hallucinate capabilities, or simply fail to make progress.
2. **Debugging nightmares**: When things went wrong, it was nearly impossible to understand why or how to fix it.
3. **Context window bloat**: As conversations grew longer, the agents would lose track of earlier context or exceed token limits.
4. **Lack of control**: The frameworks made too many decisions for us, leaving us unable to customize critical behaviors.

## The Framework Fatigue Phase

Next, we tried other frameworks - each promising to solve the problems of the last. We experimented with CrewAI for multi-agent collaboration, AutoGen for more structured agent interactions, and even built our own mini-frameworks on top of these tools.

While each framework had its strengths, they all shared a common weakness: they abstracted away too much of the underlying mechanics, making it difficult to build truly robust systems. We found ourselves fighting against the frameworks as much as we were leveraging them.

The breaking point came when we tried to implement a seemingly simple feature: having an agent remember the context of a conversation across multiple sessions. What should have been straightforward turned into a complex integration challenge that required hacking around the framework's assumptions.

## The Turning Point: Back to First Principles

In late 2023, we decided to take a step back and reconsider our approach. Instead of starting with a framework and trying to bend it to our needs, what if we started with first principles and built exactly what we needed?

We began by defining the core capabilities we wanted in our agents:
- Reliable execution of tasks
- Clear separation between reasoning and action
- Maintainable codebase that developers could understand
- Ability to handle errors gracefully
- Human oversight for critical operations

This led us to a much simpler architecture: use LLMs to convert natural language to structured tool calls, then use traditional programming patterns to handle those tool calls. No complex frameworks, no black-box reasoning - just clean interfaces between components.

## The Linear Assistant Experiment

Our first production system built on these principles was the Linear Assistant - an agent that helps teams manage their project workflows in Linear through email interactions. It was deliberately focused on a narrow domain, but within that domain, it was remarkably effective.

The Linear Assistant could:
- Create and update issues based on email requests
- Ask for clarification when needed
- Handle errors gracefully and adapt its approach
- Maintain context across multiple interactions
- Involve humans for approval of sensitive operations

What made this approach different was its simplicity. Instead of trying to be everything to everyone, it did one thing well. And instead of relying on complex frameworks, it used patterns familiar to any software developer.

## Codifying the Approach: 12-Factor Agents

As we built more agents using this approach, we began to see common patterns emerge. These patterns weren't specific to any particular domain or use case - they were fundamental principles for building robust agent systems.

We codified these principles as the "12-Factor Agents" methodology, inspired by Heroku's influential 12-Factor App framework for building cloud-native applications. Just as the original 12-Factor App methodology helped developers navigate the transition to cloud computing, we hope our 12-Factor Agents methodology will help developers build robust, maintainable AI agents.

The Future of Agents: Will AI Agents Replace Classic Workflow Automation?
A Look at the Future of AI-native Automation
Paulo Nascimento and Dex Horthy
Dec 23, 2024

This post was co-authored with Dex from HumanLayer, thanks for the feedback and sketches for this post!

Type your email...
Subscribe
As AI agents evolve, will they render classic workflow automation obsolete, or will bottlenecks in scaling laws, data, and computation keep traditional systems relevant?

We've been spending a lot of time chatting about this, and here is what we have figured out so far.

Background Context
If technology continues evolving at its current rate, here's where I think agents will be in two years.

What Are "Agents"?
2024 was the year we spent way too much time arguing about "what it means to be an agent" and "it's not an agent unless it …". When I refer to "agents," I mean LLMs paired with tools that independently make decisions and perform actions.

The Emergence of Chain of Thought (CoT) Reasoning / Test-time Compute in Models
We are starting to see models like o1 and o3, which have Chain of Thought (CoT) reasoning built into them through test-time compute. Test-time compute essentially allows a model to spend more time exploring different solutions and reasoning to arrive at the most accurate answer. This enables more reliable LLM outputs and better reasoning for advanced workflows.

This development will allow "agents" to think with greater trust and accuracy as they explain their thought processes, moving that logic out of the framework and behind the model API. We can implement human-in-the-loop for critical chain of thought steps and use that human feedback for post-training to enhance the agent's performance.

Early Indicators of Adoption: Cursor Composer
It might sound ambitious for this to be adopted at scale, but we're already seeing early indications of it. Take Cursor Composer, for example it essentially writes code for you, applies it to the appropriate files in your codebase, and waits for your approval before implementing changes. For something as sensitive as code—where mistakes could be catastrophic—this demonstrates that users are increasingly willing to trust these systems.

The Staggered Adoption of "Agents"

Whether you're writing simple Python scripts or deploying to a sophisticated workflow orchestrator like Celery, Airflow, Prefect, or hundreds of others, almost any software can be represented as a directed graph (DG). Later, when traditional ML took off, we started to see some non-deterministic steps for summarizing, classifying, and maybe even determining the next step in a graph.


Example of slightly newer AI workflows
The Promise of Agents

One basic definition of AI Agents is the generalization of this node from the workflow above.

If an LLM can decide what the next step in any given workflow is, then maybe we don't need to code up the DAG at all - we can just say "here's your prompt, here's a bunch of tools, go figure it out".


This is the core of the ReAct Agent paper - think about what to do, do it, and decide if we're done, otherwise, pick the next action.

I think "agent" adoption will follow a staggered distribution. Early versions (as we're seeing now) likely utilize DAGs and traditional ML classification models for lightweight tasks, such as routing functions to the appropriate agent.

The Problem
Current Agent Complexity Challenges

Fully autonomous agents don't yet function effectively in production because, when you have, say, 30-50 tools being passed to your LLM, it cannot reliably determine which tool to route to, especially after several turns. This not only reduces accuracy but also increases inference costs over time due to the extensive CoT reasoning required by agents.

What Actually Works

Example of current-day AI agent workflows w/ micro agents
Example of current-day AI agent workflows with micro agents.

Some systems utilize 'micro agents' to automate tasks with AI.

Why Multi-Agent Architecture Is on the Rise

Example of multi-agent architecture
Keeping the context window limited to 3-5 tools and 3-5 steps has proven to be the most effective approach based on observations. This is why multi-agent architecture is gaining popularity; with a hierarchy of agents, they can collaborate on hundreds of steps and utilize hundreds of tools without any single context window becoming too large.

TL;DR: Early "agents" will be LLMs utilizing a few (3-5) tools and/or DAGs for more complex workflows.
