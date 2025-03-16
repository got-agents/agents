import fetch from 'node-fetch';

export function vercelClient() {
  const token = process.env.VERCEL_BEARER_TOKEN
  if (!token) {
    throw new Error('VERCEL_BEARER_TOKEN is not set')
  }
  const teamId = process.env.VERCEL_TEAM_ID
  if (!teamId) {
    throw new Error('VERCEL_TEAM_ID is not set')
  }
  const projectId = process.env.VERCEL_PROJECT_ID
  if (!projectId) {
    throw new Error('VERCEL_PROJECT_ID is not set')
  }

  return {
    getRecentDeployments: async () => {
      return getRecentDeployments({teamId, projectId, token})
    }
  }
}

async function fetchVercel<T>(endpoint: string, options: {
  token?: string;
  headers?: Record<string, string>;
  method?: string;
} = {}): Promise<T> {
  const baseUrl = 'https://api.vercel.com'
  const url = `${baseUrl}${endpoint}`
  console.log(`Making request to ${url}`)

  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${options.token}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })

  if (!response.ok) {
    // probably want more detailed errors
    const error = await response.json().catch(() => ({ message: response.statusText }))
    throw new Error(`Vercel API error: ${error} ${response.statusText}`)
  }

  // Only try to parse JSON if there's content
  const contentType = response.headers.get('content-type')
  if (contentType && contentType.includes('application/json')) {
    return response.json() as T
  }

  // Return null for empty responses
  return null as T
} 

export async function getRecentDeployments({teamId, projectId, token}: {
  teamId: string;
  projectId: string;
  token: string;
}) {
  // Get latest deployments
  const deployments = await fetchVercel<{
    deployments: {
      uid: string;
      url: string;
      created: number;
      target: string;
      state: string;
      meta: {
        githubCommitSha: string;
        githubCommitRef: string;
        githubCommitAuthorLogin: string;
        githubCommitMessage: string;
      };
      readyState: string;
      readySubstate: string;
    }[];
  }>(
    `/v6/deployments?teamId=${teamId}&projectId=${projectId}&limit=100`,
    {
      token,
      method: 'GET',
    },
  )

  const makeVercelUrl = (uid: string) => `https://vercel.com/humanlayer/humanlayer-app-production/${uid.indexOf('dpl_') === 0 ? uid.slice(4) : uid}`

  const deploymentsToLog: {
    uid: string;
    previewURL: string;
    createdAt: string;
    target: string;
    state: string;
    readyState: string;
    readySubstate: string;
    commitSha: string;
    commitRef: string;
    commitAuthor: string;
    commitMessage: string;
    viewOnVercelURL: string;
  }[] = deployments.deployments.map(d => ({
    uid: d.uid,
    previewURL: d.url,
    createdAt: new Date(d.created).toISOString(),
    target: d.target,
    state: d.state,
    readyState: d.readyState,
    readySubstate: d.readySubstate,
    commitSha: d.meta?.githubCommitSha?.slice(0, 7),
    commitRef: d.meta?.githubCommitRef,
    commitAuthor: d.meta?.githubCommitAuthorLogin,
    commitMessage: d.meta?.githubCommitMessage.slice(0, 60),
    viewOnVercelURL: makeVercelUrl(d.uid),
  }))

  // Sort deployments by creation date, newest first
  deploymentsToLog.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

  // Filter to only show production deployments
  const productionDeployments = deploymentsToLog.filter(d => d && d.target === 'production')
  console.log('Found production deployments:')

  const currentDeployment = productionDeployments.find(d => d.readySubstate === 'PROMOTED')
  if (!currentDeployment) {
    console.log('No promoted deployment found')
  }
  console.log('Current deployment:', currentDeployment)

  return {
    currentDeployment: currentDeployment,
    recentDeployments: productionDeployments.slice(0, 10),
  }

}
