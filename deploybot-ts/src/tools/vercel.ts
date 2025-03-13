import fetch from 'node-fetch';

export interface VercelDeployment {
  name: string;
  url: string;
  status: string;
  created_at: string;
  author: string;
  environment: string; // 'production', 'preview', etc.
  is_current_production: boolean;
  commit_message?: string;
  branch?: string;
  deployment_id: string;
}

/**
 * Fetches deployments from Vercel API
 * TODO - claude wrote this and IDK if its correct
 * @returns List of deployments
 */
export async function listVercelDeployments(): Promise<VercelDeployment[]> {
  const token = process.env.VERCEL_BEARER_TOKEN;
  const projectId = process.env.VERCEL_PROJECT_ID;
  
  if (!token || !projectId) {
    throw new Error('Missing required environment variables: VERCEL_BEARER_TOKEN or VERCEL_PROJECT_ID');
  }

  // First, get the project aliases to determine production deployment
  const aliasesResponse = await fetch(`https://api.vercel.com/v9/projects/${projectId}/domains?teamId=${process.env.VERCEL_TEAM_ID}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  if (!aliasesResponse.ok) {
    console.warn(`Could not fetch domains: ${aliasesResponse.status} ${aliasesResponse.statusText}`);
  }

  // Find production deployment ID
  let productionDeploymentId = '';
  try {
    const aliasesData = await aliasesResponse.json() as any;
    if (aliasesData.domains && Array.isArray(aliasesData.domains)) {
      // Look for production domains
      const productionDomain = aliasesData.domains.find((domain: any) => 
        domain.productionDeploymentId || 
        (domain.gitBranch === 'main' || domain.gitBranch === 'master')
      );
      
      if (productionDomain) {
        productionDeploymentId = productionDomain.productionDeploymentId || '';
        console.log(`Found production deployment ID: ${productionDeploymentId}`);
      }
    }
  } catch (error) {
    console.warn('Error parsing domains response:', error);
  }

  // Now get all deployments
  const response = await fetch(`https://api.vercel.com/v6/deployments?projectId=${projectId}&limit=10&teamId=${process.env.VERCEL_TEAM_ID}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Vercel API error fetching deployments: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as any;
  
  if (!data.deployments || !Array.isArray(data.deployments)) {
    throw new Error('Unexpected response format from Vercel API');
  }

  // Process deployments to extract useful information
  return data.deployments.map((deployment: any) => {
    // Extract git branch and commit message if available
    const meta = deployment.meta || {};
    const gitBranch = meta.gitBranch || meta.branch || 'unknown';
    const commitMessage = meta.githubCommitMessage || meta.commitMessage || '';
    const commitAuthor = meta.githubCommitAuthorName || meta.commitAuthorName || 'unknown';
    
    // Determine if this is a production deployment
    const isProduction = deployment.id === productionDeploymentId || 
                         deployment.target === 'production' ||
                         gitBranch === 'main' || 
                         gitBranch === 'master';
    
    return {
      name: deployment.name || 'unnamed',
      url: deployment.url ? `https://${deployment.url}` : 'no-url',
      status: deployment.state || 'unknown',
      created_at: deployment.created ? new Date(deployment.created).toISOString() : 'unknown',
      author: commitAuthor,
      environment: deployment.target || 'preview',
      is_current_production: isProduction,
      commit_message: commitMessage,
      branch: gitBranch,
      deployment_id: deployment.id || 'unknown'
    };
  });
}
