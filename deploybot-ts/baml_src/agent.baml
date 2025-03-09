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


// 

class HumanResponse {
  event_type "human_response"
  message string
}


class EmailMessage {
  from_address string
  to_address string[]
  cc_address string[]
  subject string
  content string
  datetime string
}

class EmailPayload {
  from_address string
  to_address string
  subject string
  body string
  message_id string
  previous_thread EmailMessage[]
  raw_email string
  is_test bool?
}

class SlackMessage {
  from_user_id string
  channel_id string
  content string
  message_id string
}


class SlackThread {
  thread_ts string
  channel_id string
  events SlackMessage[]
}

//
// Events and Threads
//
class Event {
  type string
  data EmailPayload | RunCustomJavascriptCode | ListEnvironmentVariablesAvailableToCode | AskLuneCodingQuesiton | ClarificationRequest | DoneForNow | HumanResponse | IntentListVercelDeployments | IntentPromoteVercelDeployment | IntentListGitCommits | IntentListGitTags | IntentPushGitTag | string
}


class Thread {
  initial_email EmailPayload?
  initial_slack_message SlackThread?
  events Event[]
}


function DetermineNextStep(
    // to keep this clean, make the client turn the thread into a prompt-ready string, 
    // didn't wanna solve that in jinja (although long term that's probably the best solution)
    thread: string 
) -> ClarificationRequest | DoneForNow | RunCustomJavascriptCode | IntentListGitCommits | IntentListGitTags | IntentPushGitTag | IntentListVercelDeployments | IntentPromoteVercelDeployment {
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

