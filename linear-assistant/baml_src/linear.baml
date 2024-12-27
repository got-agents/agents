class ClarificationRequest {
    intent "request_more_information"
    message string
}

class CreateIssue {
    intent "create_issue"
    issue Issue
}

class ListTeams {
    intent "list_teams"
    teams string[]
}

class ListIssues {
    intent "list_issues"
    from_time string
    to_time string
}

class DoneForNow {
    intent "done_for_now"
    message string
}

class HumanResponse {
    event_type "human_response"
    message string
}


class Issue {
    id string?
    title string
    description string
    team_id string
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

class Event {
    type "email_received" | "human_response" | "issue_create_result" | "list_teams_result" | "list_issues_result" | "request_more_information" | "create_issue" | "done_for_now" | "list_teams" | "list_issues"
    data EmailPayload | HumanResponse | ClarificationRequest | CreateIssue | ListTeams | ListIssues | DoneForNow | string // escape hatch for untyped data from linear client
}


class Thread {
    initial_email EmailPayload
    events Event[]
}


function DetermineNextStep(
    thread: string // to keep this clean, make the client turn the thread into a prompt-ready string, didn't wanna solve that in jinja (although long term that's probably the best solution)
) -> ClarificationRequest | CreateIssue | ListTeams | ListIssues | DoneForNow {
    client CustomGPT4o
    prompt #"
        {{ _.role("system") }}

        You are a helpful assistant that helps the user with their linear issue management.

        {{ _.role("user") }}

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
              
      <create_issue>: 
                  Title: Restock fridges with tasty beers
                  Description: Austin is requested to restock the fridges with tasty beers.
                  Team ID: team_supply_maintenance
              </create_issue>
              
      <issue_create_result>: 
                  {"errors": [{"message": "Argument Validation Error", "path": ["issueCreate"], "locations": [{"line": 3, "column": 13}], "extensions": {"code": "INVALID_INPUT", "type": "invalid input", "userError": true, "userPresentableMessage": "teamId must be a UUID.", "meta": {}}}], "data": null}
              </issue_create_result>
              
          
    "#
  }
  @@assert({{this.intent == "request_more_information"}})
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
