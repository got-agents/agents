# slack deploy bot

An e2e whitelabeled humanlayer integration to help out with deployments

## Capabilities

- promote a vercel deployment in the production app
- push a git tag to the production repo

## Usage

### Promote a vercel deployment

```
user
---
@deploybot promote the last web commit to production
```

```
deploybot
---
agent deploy bot needs approval to run function vercel-deploy

function: vercel-deploy
commit: a39d1ee
date: 2025-03-07
message: merge PR #123 "fix bug in projects dropdown"
author: sundeep
status: Staged

|Approve| |Reject|
```

-> reject "not that one, the one with the org route changes"

```
deploybot
---
agent deploy bot needs approval to run function vercel-deploy

function: vercel-deploy
commit: 1eea39d
date: 2025-03-07
message: merge PR #123 "refactor org routes"
author: sundeep
status: Staged

|Approve| |Reject|
```

-> approve


### Push a git tag to the production repo

```
user
---
@deploybot deploy backend
```

```
deploybot
---
agent deploybot needs approval to run function git-tag

function: git-tag
commit: 1eea39d
message: merge PR #123 "refactor org routes"
date: 2025-03-07
author: sundeep
previous_tag: v0.3.80 revamp spline reticulator
new_tag: v0.3.81

|Approve| |Reject|
```

-> reject "wait what are the last 5 commits?"

```
deploybot
---
deploybot: The last 3 commits are:

- 1eea39d refactor org routes
- a39d1ee fix bug in projects dropdown
- 39d1ea3 revamp spline reticulator (v0.3.81)

Which commit would you like to tag?
```

-> respond okay yeah, 1eea39d is right

```
deploybot
agent deploy bot needs approval to run function git-tag

function: git-tag
commit: 1eea39d
message: merge PR #123 "refactor org routes"
author: sundeep
previous_tag: v0.3.80 revamp spline reticulator
new_tag: v0.3.81

|Approve| |Reject|
```

-> approve

```
deploybot
---
deploybot: tagged v0.3.81, 

```


## Tools

- list vercel deployments (use the vercel sdk)
- promote vercel deployment
- list git tags on production repo
- list git commits on production repo
- push a git tag to the production repo
- done_for_now

## HumanLayer integration points

- init workflow from slack (this feature does not exist!), see humanlayer/humanlayer - humanlayer/models_agent_webhook.py


## Agent architecture notes

- baml agent in got-agents repo
- typescript / express (okay fine pick whatever node webserver you want)

## outer loop

cases in which the agent starts a new workflow without human intervention:

### PR merged and all tests passed

```
deploybot
---
deploybot: PR #135 merged and all tests passed, do you want to deploy?
|Respond| |Yes|
```

-> respond "yes"

```
deploybot
---
agent deploybot needs approval to run function git-tag

function: git-tag
commit: 131e39d
date: 2025-03-07
message: merge PR #135 "improve slack webhook verification"
author: sundeep
previous_tag: v0.3.81 
new_tag: v0.3.82

|Approve| |Reject|
```

-> approve

```
deploybot
---
agent deploybot needs approval to run function vercel-deploy

function: vercel-deploy
commit: 131e39d
message: merge PR #135 "improve slack webhook verification"
author: sundeep

|Approve| |Reject|
```

-> approve

### Undeployed Changes

```
deploybot
---
deploybot: There are unstaged changes in the production repo, do you want to deploy? They include:

- 1eea39d refactor org routes
- a39d1ee fix bug in projects dropdown


|Respond| |Yes|
```

-> respond "yes"

... etc etc do both things again

## Prompt drafts

### Inbound message

when an inbound message is sent by a user, the agent will use this prompt

*System Message*

```
You are a helpful assistant that can help with software deployment tasks.

Your team is structured as follows:

### Overview
- engineers hang out in the #engineering channel in slack. 
- engineers work in a single monorepo, metalytics-dev/metalytics
- the repo contains both frontend and backend code

### Frontend
- frontend deployments are managed in vercel. On merge, the frontend will automatically deploy to the humanlayer-app-development environment - this is a staging/preview environment.
- 

### Backend

You have the following capabilities:

- list vercel deployments
- promote a vercel deployment
- list git tags on production repo
- list git commits on production repo
- push a git tag to the production repo

You can help with the following tasks

-
-
-

```

*User Message*

The user message will be whatever message was sent by the user in slack

```
{{user_message}}
```

### Daily check for stale commits

the bot will check daily (twice daily!?) for stale commits on the production repo.
This means commits that have been merged but not deployed to production.

*System Message*

This uses the same system prompt as above, but with a different user message

*User Message*

```
you are doing your daily check for stale commits.

The current time is {{current_time}}

the last few git commits are:

{% for commit in git_commits %}
<commit>
message: {{commit.message}} 
date: {{commit.date}} 
author: {{commit.author}} 
sha: {{commit.sha}} 
tags: {{commit.tags}}
</commit>
{% endfor %}

the last few vercel deployments in production are:

{% for deployment in vercel_deployments %}
<deployment>
name: {{deployment.name}}
url: {{deployment.url}}
status: {{deployment.status}} # Preview, Staged, Current
created_at: {{deployment.created_at}}
</deployment>
{% endfor %}

You should always message users first if you want to recommend deploying, for example:

<example>
Hey {{user_name}}, I noticed that there are 3 commits in main that haven't been deployed to production yet.

shall we deploy the latest?
</example>

```


### what else!?

## Structured Outputs

```baml

// data classes

class GitCommit {
    author string
    date datetime
    message string
    sha string
    url string 
    tags string[]
}

class VercelDeployment {
    name string
    url string
    status string # Preview, Staged, Current
    created_at datetime
    author string
}

// human functions / control flow

class IntentRequestClarification {
    intent "request_clarification" @description("request clarification from the user")
    question string @description("the question to ask the user")
}

class IntentDoneForNow {
    intent "done_for_now" 
    message string @description("a description of the work that was completed")
}

class IntentNothingToDo {
    intent "nothing_to_do" @description("there's nothing to do right now, go to sleep for a while")
}


// read functions
class IntentListCommits {
    intent "list_commits" @description("list the git commits")
}

class IntentListVercelDeployments {
    intent "list_vercel_deployments" @description("list the vercel deployments")
}

class IntentGitTag {
    intent "git_tag" @description("tag a new git commit")
    new_tag string
    new_commit GitCommit @description("the new git commit to tag")
    previous_commit GitCommit @description("the most recently tagged git commit")
}

// write functions
class IntentPromoteVercelDeployment {
    intent "promote_vercel_deployment" @description("promote a vercel deployment")
    vercel_deployment VercelDeployment @description("the vercel deployment to promote")
    previous_deployment VercelDeployment @description("the currently deployed vercel deployment")
}
```
