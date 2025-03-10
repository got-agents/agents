//
// Async Steps - pause and wait for a human
//
class ClarificationRequest {
  intent "request_more_information" @description("you can request more information from me")
  message string
}

class DoneForNow {
  intent "done_for_now"


  message string @description(#"
    message to send to the user about the work that was done. 
    TRY VERY HARD to include a link to the commit or deployment in the message.
  "#)
}


function DetermineNextStep(
    // to keep this clean, make the client turn the thread into a prompt-ready string, 
    // didn't wanna solve that in jinja (although long term that's probably the best solution)
    thread: string 
) -> ClarificationRequest | DoneForNow | IntentListGitCommits | IntentListGitTags | IntentPushGitTag | IntentListVercelDeployments | IntentPromoteVercelDeployment {
    client CustomGPT4o

    prompt #"
        {{ _.role("system") }}

        You are a helpful assistant that can help with software deployment tasks.

        Your team is structured as follows:

        ### Overview
        - Engineers work in a single monorepo, with both frontend and backend code
        - Frontend deployments are managed in Vercel
        - On merge, frontend automatically deploys to staging/preview environment
        - Backend deployments are managed via git tags

        You have the following capabilities:
        - List Vercel deployments to see what's deployed where
        - Promote a Vercel deployment from staging to production
        - List git tags and commits on the production repo
        - Push new git tags to deploy backend changes
        - Contact a human for clarification, next steps, or to notify them of progress

        Always think carefully about what to do next:
        - Check if there are any undeployed changes that need attention
        - Verify the correct commit/deployment is being promoted
        - Get clarification from users if needed
        - Confirm actions before executing them
        - Keep users informed of deployment status

        You should:
        - Be helpful but cautious with deployments
        - Double check details before taking action
        - Ask for clarification when needed
        - Keep users informed of progress
        - Handle one deployment task at a time
        - Verify successful completion


        {{ _.role("user") }}

        You are working on the following thread:

        {{ thread }}


        What should the next step be?

        {{ ctx.output_format }}
    "#
}

test InboundGitCommits {

  functions [DetermineNextStep]
  args {
    thread #"
      
          Events:
              <message>
              what are my last 3 git commits? 
              </message>
    "#
  }
  @@assert(intent, {{this.intent == "list_git_commits"}})
}


test TestUndeployedCommits {
  functions [DetermineNextStep]
  args {
    thread #"
      <slack_message_received>
                is_test: false
      type: agent_slack.received
      event:
        thread_ts: '1741484452358769'
        channel_id: C07HR5LJ0KT
        events:
          - from_user_id: U07HR5DNQBB
            channel_id: C07HR5LJ0KT
            content: do we have any git commits that need to be deployed?
            message_ts: '1741484452358769'
      
      </slack_message_received>
            
    "#
  }
  @@assert(intent, {{this.intent == "list_git_commits"}})
}