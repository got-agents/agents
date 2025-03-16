class GitCommit {
    author string
    date string
    message string
    sha string
    url string 
    tags string[]
    markdown string @description(#"
        markdown formatted string to display to the user describing this commit
    "#)
}

class IntentListGitCommits {
    intent "list_git_commits" @description("list the git commits")
    limit int? @description("the number of commits to list default is 20")
}

class IntentListGitTags {
    intent "list_git_tags" @description("list the git tags")
    limit int? @description("the number of tags to list default is 20")
}

class IntentTagPushProd {
    intent "tag_push_prod" @description(#"
        run a github action workflow_dispatch job to deploy the latest backend commit to production

        note that this only starts the workflow, it does not wait for it to complete
    "#)
    new_commit GitCommit @description("the new git commit to tag")
    previous_commit GitCommit @description("the most recently tagged git commit")
}


class IntentListGithubWorkflowRuns {
    intent "list_github_workflow_runs" @description("list recent github workflows for a given workflow id")
    workflow_id "vercel-promote-to-prod.yaml" | "tag-and-push-prod.yaml"
    limit int? @description("the number of workflows to list default is 3")
}
