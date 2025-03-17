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

class NothingToDo {
  intent "nothing_to_do" @description("emit this intent if there is nothing to do")
  message string @description(#"
    emit this intent if there is nothing to do. 
    This message will not be sent to a human, it will just be logged to the server.
  "#)
}

class Await {
  intent "await" @description("emit this intent if you need to wait for something to happen")
  seconds int @description(#"the number of seconds to wait for something to happen."#)
  reasoning string @description(#"some explanation of what you're waiting for and why"#)
}


function DetermineNextStep(
    // to keep this clean, make the client turn the thread into a prompt-ready string, 
    // didn't wanna solve that in jinja (although long term that's probably the best solution)
    thread: string 
) -> Await | ClarificationRequest | DoneForNow | IntentListGithubWorkflowRuns | IntentListGitCommits | IntentListGitTags | IntentTagPushProd | IntentListVercelDeployments | IntentPromoteVercelDeployment | NothingToDo {
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

        ### Capabilities

        You have many tools at your disposal, you may use them all or none of them.

        Deploying the frontend:
        - You can List Vercel deployments to see what's deployed where
        - You can run a github workflow_dispatch job to Promote a Vercel deployment from STAGED to PROMOTED

        Deploying the backend:
        - You can List git tags on the repo
        - You can List git commits on the repo
        - You can run a github workflow_dispatch job to tag and push a new backend commit to production

        ### Guidelines

        Always think carefully about what to do next:
        - Check if there are any undeployed changes that need attention
        - Verify the correct commit/deployment is being promoted
        - Get clarification from users if needed
        - Keep users informed of deployment status

        You should:
        - Be helpful but cautious with deployments
        - Double check details before taking action
        - Ask for clarification when needed
        - Keep users informed of progress
        - Handle one deployment task at a time
        - Verify successful completion

        When describing a vercel deployment, always include:
        - the Git sha with a link to the commit, e.g. https://github.com/metalytics-dev/metalytics/commit/SHA
        - the link to view the deployment in vercel
        - the commit message and author from the git commit

        After triggering a vercel deployment or backend deployment via github actions workflow dispatch,
        the user will want to know the URL of the running github action workflow.

        Team Process:
        - Don't try to promote a vercel deployment that is older than the current production deployment, unless EXPLICITLY asked to do so
        - If the latest vercel deployment is not READY / STAGED, (for example, if its in QUEUED or BUILDING), you won't be able to promote it. 
        - if you are waiting for a vercel deployment to be ready, you can try the "await" tool for 10-60 seconds if you want


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