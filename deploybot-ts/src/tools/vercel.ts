import fetch from 'node-fetch';

export interface VercelDeployment {
  name: string;
  url: string;
  status: string;
  created_at: string;
  author: string;
  environment: string; // 'production', 'preview', etc.
  is_current_production: boolean;
}

/**
 * Fetches deployments from Vercel API
 * @returns List of deployments
 */
export async function listVercelDeployments(): Promise<VercelDeployment[]> {
  const token = process.env.VERCEL_BEARER_TOKEN;
  const projectId = process.env.VERCEL_PROJECT_ID;
  
  if (!token || !projectId) {
    throw new Error('Missing required environment variables: VERCEL_BEARER_TOKEN or VERCEL_PROJECT_ID');
  }

  // Now get all deployments
  const response = await fetch(`https://api.vercel.com/v6/deployments?projectId=${projectId}&limit=10`, {
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

  return data.deployments;
}
