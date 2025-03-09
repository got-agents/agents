class VercelDeployment {
    name string
    url string
    status string // Preview, Staged, Current or something...need to get the enum values
    created_at string
    author string
}

class IntentListVercelDeployments {
    intent "list_vercel_deployments" @description("list the vercel deployments")
}

class IntentPromoteVercelDeployment {
    intent "promote_vercel_deployment" @description("promote a vercel deployment")
    vercel_deployment VercelDeployment @description("the vercel deployment to promote")
    previous_deployment VercelDeployment @description("the currently deployed vercel deployment")
}
