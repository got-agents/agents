Agents 


[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/got-agents/agents)

## The Development of 12-Factor Agents

The release of ChatGPT in late 2022 triggered widespread experimentation with autonomous AI systems. Engineering teams across the industry tested frameworks like LangChain, AutoGPT, and BabyAGI to build agents capable of reasoning and acting with minimal human supervision.

These experiments quickly revealed significant production challenges:

1. **Reliability issues**: Agents frequently got stuck in loops, hallucinated capabilities, or failed to progress on tasks
2. **Debugging complexity**: Tracing through chains of thought to identify errors proved nearly impossible
3. **Context management limitations**: Longer conversations caused agents to lose track of context or exceed token limits
4. **Framework constraints**: Existing solutions abstracted away too much, hindering necessary customization

This pattern has become all too familiar in AI tooling: frameworks that make you productive quickly but require significant reverse-engineering to move from 80% to even 85% effectiveness, as you navigate through layers of abstractions and prompt templates. Despite claims of innovation, many solutions are simply repackaging the basic concept of "getting an LLM to output structured JSON" - a capability that's existed for nearly two years.

The fundamental tension in AI development tools is the balance between flexibility and productivity:
- **Too easy to get started?** You're likely stuck with a black box.
- **Too flexible?** You're left with a thin layer in what's essentially your own custom codebase.

After testing multiple frameworks and encountering these consistent limitations, we identified the need for a fundamentally different approach. Instead of adapting frameworks to our requirements, we rebuilt from first principles, focusing on:

- Clear separation between reasoning and action
- Maintainable code using familiar design patterns
- Robust error handling
- Effective human oversight

This led to a simpler architecture: using LLMs to convert natural language to structured tool calls, then handling those tool calls with traditional programming patterns. Our first production implementation was the Linear Assistant - an agent helping teams manage project workflows through email interactions. Its effectiveness stemmed from its focused scope and architectural simplicity.

We stripped everything back to fundamentals: defining clear interfaces between components, separating reasoning from action, and building testable, maintainable systems that happened to use LLMs, rather than LLM systems that happened to be software.

As we built more agents using this approach, common patterns emerged that transcended specific domains or use cases. We codified these as the "12-Factor Agents" methodology, inspired by Heroku's influential 12-Factor App framework for cloud-native applications. Our goal is to help teams build robust, maintainable AI agents that deliver consistent value in production environments - finding that elusive sweet spot between frameworks that are too opinionated and solutions so flexible you might as well build everything yourself.

