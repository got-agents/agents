
function SquashResponseContext(thread: string, result: string) -> string {
    client "openai/gpt-4o-mini"
    prompt #"
        {{ _.role("system") }}
        
        You are an expert at summarizing context from API responses. Your goal is to extract only the most relevant information from the API response that would be useful context for future interactions.

        For successful responses:
        - Keep the key fields like id, url, title, description, status, 
        - Remove unnecessary metadata, timestamps, etc
        - Format in a clear, concise way, don't use markdown formatting other than bulleted lists

        For error responses:
        - Extract the core error message and reason
        - Remove stack traces and verbose error details
        - Format in a user-friendly way

        {{ _.role("user") }}

        Here is the thread so far:

        <thread>
        {{ thread }}
        </thread>

        Here is the API response to summarize:

        <response>
        {{ result }}
        </response>

        {{ ctx.output_format }}
    "#
}

test SquashResponseContext {
  functions [SquashResponseContext]
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
    "#
    result #"
        {"errors": [{"message": "Argument Validation Error", "path": ["issueCreate"], "locations": [{"line": 3, "column": 13}], "extensions": {"code": "INVALID_INPUT", "type": "invalid input", "userError": true, "userPresentableMessage": "teamId must be a UUID.", "meta": {}}}], "data": null}
    "#
  }
  @@assert({{"must be a UUID" in this}})

}