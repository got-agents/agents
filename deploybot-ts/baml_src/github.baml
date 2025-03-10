class GitCommit {
    author string
    date string
    message string
    sha string
    url string 
    tags string[]
}

class IntentListGitCommits {
    intent "list_git_commits" @description("list the git commits")
}

class IntentListGitTags {
    intent "list_git_tags" @description("list the git tags")
}

class IntentPushGitTag {
    intent "push_git_tag" @description("push a new git tag")
    new_tag string
    new_commit GitCommit @description("the new git commit to tag")
    previous_commit GitCommit @description("the most recently tagged git commit")
}

