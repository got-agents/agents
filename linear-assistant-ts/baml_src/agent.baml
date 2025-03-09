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
  message_ts string
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
  data EmailPayload | HumanResponse | CreateIssue | ListTeams | ListIssues | ClarificationRequest | DoneForNow | ListTeams | ListUsers | AddComment | SearchIssues | GetIssueComments | ListLabels | ListProjects | AddUserToLoopsMailingList | UpdateIssue | ListWorkflowStates | string
}


class Thread {
  initial_email EmailPayload
  events Event[]
}

class SlackInitiatedThread {
  initial_slack_message SlackThread
  events Event[]
}


function DetermineNextStep(
    // to keep this clean, make the client turn the thread into a prompt-ready string, 
    // didn't wanna solve that in jinja (although long term that's probably the best solution)
    thread: string 
) -> ClarificationRequest | CreateIssue | ListTeams | ListIssues | ListUsers | DoneForNow | AddComment | SearchIssues | GetIssueComments | ListLabels | ListProjects | AddUserToLoopsMailingList | ListLoopsMailingLists | ListWorkflowStates | UpdateIssue | SearchLabels {
    client CustomGPT4o

    prompt #"
        {{ _.role("system") }}

        You are a helpful assistant that helps the user with their linear issue management.
        You work hard for whoever sent the inbound initial email, and want to do your best
        to help them do their job by carrying out tasks against the linear api.


        Before creating an issue, you should ensure you have accurate team/user/project ids. 
        You can list_teams and list_users and list_projects functions to get ids.

        If you are BCC'd on a thread, assume that the user is asking you to look up the related issue and add a comment about the latest with that issue.

        Always think about what to do first, like:

        - ...
        - ...
        - ...

        {{ _.role("user") }}

        Linear is a project management tool that helps teams manage their work. 
        You are managing my linear board by creating issues, adding comments, and updating issues.


        I use several types of issues in the linear for different tasks:

        - CRM - issues in the Operations team / Networking project - one issue to track status, progress, and todos for a person or company
            - For Sales: I use the prospect, deal-stage labels
            - For potential hires: I use the potential-hire label
            - For customers: I use the customer and success-stage labels
            - There are also some uncategorized issues that represent other types of people I want to stay networked with, like VCs, founders, etc

        - Product and Engineering - issues in the Engineering team track bugs, fixes, and features

        - Operations - issues in the Operations upkeep project track operational tasks like finance, accounting, legal, hr, office management, etc etc. If it's not technical and its not about a person or company, it goes here.


        If I don't specify an assignee, you should assign it to me.

        I want you to act upon the email I sent below, working until the work is done.

        You are working on the following thread:

        {{ thread }}


        What should the next step be?

        {{ ctx.output_format }}
    "#
}

test InitialEmail {

  functions [DetermineNextStep]
  args {
    thread #"
      
          Events:
              <email_received>: 
                  {"from_address":"test@example.com","to_address":"support@company.com","subject":"New Ticket","body":"Can you make a new issue for Austin to restock the fridges with tasty beers?","message_id":"test123","previous_thread":[],"raw_email":"raw email content","is_test":null}
              </email_received>

              
          
    "#
  }
}


test TeamIDErrorAsksForMoreInput {
  functions [DetermineNextStep]
  args {
    thread #"
      
          Events:
              <email_received>:
                  {"from_address":"test@example.com","to_address":"support@company.com","subject":"New Ticket","body":"Can you make a new issue for Austin to restock the fridges with tasty beers?","message_id":"test123","previous_thread":[],"raw_email":"raw email content","is_test":null}
              </email_received>
              
      <create_issue> 
                  Title: Restock fridges with tasty beers
                  Description: Austin is requested to restock the fridges with tasty beers.
                  Team ID: team_supply_maintenance
              </create_issue>
              
      <issue_create_result>: 
                  {"errors": [{"message": "Argument Validation Error", "path": ["issueCreate"], "locations": [{"line": 3, "column": 13}], "extensions": {"code": "INVALID_INPUT", "type": "invalid input", "userError": true, "userPresentableMessage": "teamId must be a UUID.", "meta": {}}}], "data: null}"
              </issue_create_result>
              
          
    "#
  }
  @@assert({{this.intent == "list_teams"}})
}


test CompletedIssueCreate {
  functions [DetermineNextStep]
  args {
    thread #"
      
          Events:
              <email_received>
                  {"from_address":"test@example.com","to_address":"support@company.com","subject":"New Ticket","body":"Can you make a new issue for Austin to restock the fridges with tasty beers?","message_id":"test123","previous_thread":[],"raw_email":"raw email content","is_test":null}
              </email_received>
              
      <create_issue>
                  Title: Restock fridges with tasty beers
                  Description: Austin is requested to restock the fridges with tasty beers.
                  Team ID: team_supply_maintenance
      </create_issue>
              
      <issue_create_result>
                  {"errors": [{"message": "Argument Validation Error", "path": ["issueCreate"], "locations": [{"line": 3, "column": 13}], "extensions": {"code": "INVALID_INPUT", "type": "invalid input", "userError": true, "userPresentableMessage": "teamId must be a UUID.", "meta": {}}}], "data": null}
      </issue_create_result>
              
      <request_more_information>
                  {"intent":"request_more_information","message":"The team ID provided (team_supply_maintenance) is not a valid UUID, which caused the issue creation to fail. Please provide a valid UUID for the team."}
              </request_more_information>
              
      <human_response>
                  Message: use a different team id, perhaps try running list-teams?
      </human_response>
              
      <list_teams>
                  {"intent":"list_teams","teams":[]}
              </list_teams>
              
      <list_teams_result>
                  {"data": {"teams": {"nodes": [{"id": "b1af0caf-0a15-4d27-a71a-7076f71948bf", "name": "Operations", "members": {"nodes": [{"email": "...", "id": "d9b7a650-e5f3-48d7-ba25-fe72a505cdf1", "displayName": "austin"}, {"email": "...", "id": "16765c85-2286-4c0f-ab49-0d4d79222ef5", "displayName": "dexter"}]}}]}}}
      </list_teams_result>
              
      <create_issue>
                  Title: Restock fridges with tasty beers
                  Description: Austin is requested to restock the fridges with tasty beers.
                  Team ID: b1af0caf-0a15-4d27-a71a-7076f71948bf
      </create_issue>
              
      <issue_create_result>
                  {"data": {"issueCreate": {"success": true, "issue": {"id": "bd1c1df8-1399-49be-b96c-b175db42ab1e", "title": "Restock fridges with tasty beers", "description": "Austin is requested to restock the fridges with tasty beers."}}}}
      </issue_create_result>
              
          
    "#
  }
  @@assert({{this.intent == "done_for_now"}})
}
