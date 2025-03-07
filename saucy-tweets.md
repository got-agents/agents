I swear every week there’s a new person who invented tool calling
4:59 PM · Mar 5, 2025
·
244
 Views
View post engagements

dex
@dexhorthy
·
Mar 5
Who will invent tool calling next week? Find out on your favorite website x dot com
dex
@dexhorthy
·
Mar 5
Like when can we move on from wrapping yet another marketing angle around “I got the llm to make json” we’re coming up on the 2 year anniversary of function calls and autogpt and lang chain agents


with the speed of ai devtools, we're in a constant struggle to balance flexibility and productivity. 

Too easy to get started? chances are you're stuck with a black box.

Too flexible? You become a thin (or worse, hard-to-use) layer in a mostly user-defined codebase
10:57 AM · Mar 5, 2025
·
422
 Views
View post engagements

dex
@dexhorthy
·
Mar 5
thinking about llm eval tools after checking out  
@confident_ai
. this idea resonates that most frameworks are too rigid for custom eval pipelines, forcing teams to build their own
dex
@dexhorthy
·
Mar 5
but i wonder if evals (please let me know what you think!) have the same thing we all just spent stumbling through in agent frameworks - that there's a delicate balance between "abstractions that make me productive" and "black boxes that i eventually rip open to get things done"
dex
@dexhorthy
·
Mar 5
I think we have all been a little bit burned reverse-engineering at least one agent framework.

it got us productive quickly but then took a lot of digging to get from 80% to even 85% or 90%, as we spelunked through iffy abstractions and a mountain of prompt templates
dex
@dexhorthy
·
Mar 5
my current take is outside of 
@opentelemetry
  traces, which pre-date most LLM stuff, we haven't quite nailed a set of abstractions that hit the right productivity balance

I mean this for Agent Orchestration, for prompt registry, for LLM Evals, or for observability (beyond traces
dex
@dexhorthy
·
Mar 5
current prediction - someone will nail the agent orchestration layer, and then absorb evals, ollyn, etc easily

recency bias here (just played with it this week), but seeing 
@mastra_ai
 incorporate evals, traces, and prompt management in their orchestration platform is promising
dex
@dexhorthy
·
Mar 5
bottom line: skeptical of any framework claiming to solve the flexibility vs productivity tradeoff in agents. things move too fast and in general i'm mostly fine to build stuff myself

too opinionated vs so flexible you might as well do custom

still searching for that sweet spot
