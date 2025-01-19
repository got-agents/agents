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
    TRY VERY HARD to include a link to the issue in linear if possible, but don't make one up.

    If you don't have a link to the issue, you can use a search query to find it.

    Linear urls look like https://linear.app/humanlayer/issue/ISSUE_ID/ISSUE_TITLE
  "#)
}

class AddComment {
  intent "add_comment"
  issue_id string
  comment string @description("comment to add to the issue, including detail about who sent/forwarded/bcc'd you on the initial request")
  view_issue_url string @description("url to view the issue in linear")
}

class CreateIssue {
  intent "create_issue"
  issue CreateIssueRequest
}

class CreateIssueRequest {
  title string
  description string
  team_id string
  team_name string? @description("name of the team to create the issue in")
  project_id string?
  project_name string? @description("name of the project to create the issue in")
  assignee_id string?
  assignee_name string? @description(#"
    name of the user to assign the issue to
  "#)
  labels_ids string[]
  labels_names string[]
  priority int? @description(#"
        The priority of the issue. 
        0 = No priority, 1 = Urgent, 2 = High, 3 = Normal, 4 = Low.
  "#)
}

class UpdateIssue {
  intent "update_issue"
  issue_id string
  update UpdateIssueRequest
}

class UpdateIssueRequest {
  title string?
  description string?
  team_id string?
  project_id string?
  assignee_id string?
  labels_ids string[]?
  priority int? @description(#"
        The priority of the issue. 
        0 = No priority, 1 = Urgent, 2 = High, 3 = Normal, 4 = Low.
  "#)
  state_id string? @description("The ID of the workflow state to set")
  due_date string? @description("ISO date string for when this issue is due")
}




//
// Sync Steps - no interaction
//
class ListTeams {
  intent "list_teams"  // for the context compactor - helpful to know what the agent was looking for
  query_intent string? @description("what is your goal or desired outcome with this operation")
}

class ListProjects {
  intent "list_projects"  // for the context compactor - helpful to know what the agent was looking for
  query_intent string? @description("what is your goal or desired outcome with this operation? What are you looking for?")
  team_id string? @description("list projects for a given team, or all projects if no team_id is provided")
}

class ListIssues {
  intent "list_issues" @description("List issues from a given time range")  // for the context compactor - helpful to know what the agent was looking for
  query_intent string? @description("what is your goal or desired outcome with this operation? What are you looking for?")
  filter IssueFilter?
  first int?
  last int?
  after string? @description("pagination endCursor value")
  before string? @description("pagination endCursor value")
}

class IssueFilter {
  title StringComparator?
  description StringComparator?
  projectId string?
  labelIds string[]?
  stateId string?
  createdAfter string? @description("ISO date string")
  createdBefore string? @description("ISO date string")
  updatedAfter string? @description("ISO date string")
  updatedBefore string? @description("ISO date string")
}

class StringComparator {
  contains string?
  eq string?
}

class SearchIssues {
  intent "search_issues" @description("Search issues by title, description, or assignee")  // for the context compactor - helpful to know what the agent was looking for
  query_intent string? @description("what is your goal or desired outcome with this operation? What are you looking for?")
  query string @description("the linear api search query")
}

class GetIssueComments {
  intent "get_issue_comments" @description("Get comments on an issue")  // for the context compactor - helpful to know what the agent was looking for
  query_intent string? @description("what is your goal or desired outcome with this operation? What are you looking for?")
  issue_id string
}

class ListUsers {
  intent "list_users" @description("list users on a team, or all users if no team_id is provided")  // for the context compactor - helpful to know what the agent was looking for
  query_intent string? @description("what is your goal or desired outcome with this operation? What are you looking for?")
  team_id string?
}


class ListLabels {
  intent "list_labels" @description("list labels on a team, or all labels if no team_id is provided")  // for the context compactor - helpful to know what the agent was looking for
  query_intent string? @description("what is your goal or desired outcome with this operation? What are you looking for?")
  team_id string?
  label_name_contains string? @description("filter to labels whose name contains this string")
}

class ListWorkflowStates {
  intent "list_workflow_states" @description("list workflow states on a team, or all workflow states if no team_id is provided")  // for the context compactor - helpful to know what the agent was looking for
  query_intent string? @description("what is your goal or desired outcome with this operation? What are you looking for?")
  team_id string?
}

//
// Step fields and return values
//
class Label {
  id string
  name string
}

class Issue {
  id string?
  title string
  description string
  team_id string
  url string
  labels Label[]
  priority string
  state string
}
