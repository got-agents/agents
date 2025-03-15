import { Octokit } from '@octokit/rest';
import crypto from 'crypto';

// Define the GitCommit interface
export interface GitCommit {
  author: string;
  date: string;
  message: string;
  sha: string;
  url: string;
  tags: string[];
}

// GitHub webhook payload types
export interface GitHubPushEvent {
  ref: string;
  before: string;
  after: string;
  repository: {
    full_name: string;
    name: string;
    owner: {
      name: string;
      email: string;
    };
  };
  commits: Array<{
    id: string;
    message: string;
    timestamp: string;
    author: {
      name: string;
      email: string;
    };
    url: string;
  }>;
  head_commit: {
    id: string;
    message: string;
    timestamp: string;
    author: {
      name: string;
      email: string;
    };
    url: string;
  };
}

// Initialize Octokit with the GitHub token
const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
});

const owner = process.env.GITHUB_OWNER || '';
const repo = process.env.GITHUB_REPO || '';
const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET;

if (!owner || !repo) {
  throw new Error('GITHUB_OWNER and GITHUB_REPO environment variables must be set');
}

if (!webhookSecret) {
  throw new Error('GITHUB_WEBHOOK_SECRET environment variable must be set');
}

/**
 * Verify GitHub webhook signature
 * @param payload Raw request body
 * @param signature GitHub signature header
 * @returns boolean indicating if signature is valid
 */
export function verifyGitHubWebhook(payload: string, signature: string): boolean {
  if (!webhookSecret) return false;
  
  const hmac = crypto.createHmac('sha256', webhookSecret);
  const digest = hmac.update(payload).digest('hex');
  const checksum = `sha256=${digest}`;
  
  return crypto.timingSafeEqual(
    Buffer.from(checksum),
    Buffer.from(signature)
  );
}

/**
 * List recent commits from the repository
 * @param limit Number of commits to fetch (default: 1)
 * @returns Array of GitCommit objects
 */
export async function listGitCommits(limit: number = 1): Promise<GitCommit[]> {
  try {
    console.log(`Fetching latest commit from ${owner}/${repo} default branch...`);
    
    const response = await octokit.repos.listCommits({
      owner,
      repo,
      per_page: 1,  // We only need the latest commit
      sha: 'main',  // Only from main branch
    });

    if (!response.data || !Array.isArray(response.data)) {
      throw new Error('Invalid response from GitHub API - no commits data');
    }

    console.log(`Successfully fetched ${response.data.length} commits`);

    // Get all tags to match with commits
    const tags = await listGitTags();
    const tagsBySha: { [key: string]: string[] } = {};
    tags.forEach((tag: { name: string; commit: { sha: string } }) => {
      const sha = tag.commit.sha;
      if (sha) {
        if (!tagsBySha[sha]) {
          tagsBySha[sha] = [];
        }
        tagsBySha[sha].push(tag.name);
      }
    });

    return response.data.map((commit: any): GitCommit => ({
      author: commit.commit.author?.name || commit.author?.login || 'unknown',
      date: commit.commit.author?.date || new Date().toISOString(),
      message: commit.commit.message || '',
      sha: commit.sha || '',
      url: commit.html_url || '',
      tags: tagsBySha[commit.sha] || [],
    }));
  } catch (error: any) {
    // Add more detailed error information
    const errorMessage = error.response?.data?.message || error.message;
    const status = error.response?.status;
    console.error('Error fetching git commits:', {
      error: errorMessage,
      status,
      owner,
      repo,
      tokenExists: !!process.env.GITHUB_TOKEN,
      tokenPrefix: process.env.GITHUB_TOKEN?.substring(0, 10)
    });
    
    if (status === 404) {
      throw new Error(`Repository ${owner}/${repo} not found or token doesn't have access`);
    } else if (status === 401) {
      throw new Error('GitHub token is invalid or expired');
    } else {
      throw new Error(`GitHub API error: ${errorMessage}`);
    }
  }
}

/**
 * List all tags from the repository
 * @returns Array of tag objects
 */
export async function listGitTags() {
  try {
    const response = await octokit.repos.listTags({
      owner,
      repo,
    });

    return response.data;
  } catch (error) {
    console.error('Error fetching git tags:', error);
    throw error;
  }
}

/**
 * Create a new tag in the repository
 * @param tagName Name of the tag to create
 * @param sha Commit SHA to tag
 * @param message Tag message
 * @returns Created tag object
 */
export async function createGitTag(tagName: string, sha: string, message: string) {
  try {
    // First create the tag object
    const tagResponse = await octokit.git.createTag({
      owner,
      repo,
      tag: tagName,
      message,
      object: sha,
      type: 'commit',
    });

    // Then create the reference to make the tag visible
    await octokit.git.createRef({
      owner,
      repo,
      ref: `refs/tags/${tagName}`,
      sha: tagResponse.data.sha,
    });

    return tagResponse.data;
  } catch (error) {
    console.error('Error creating git tag:', error);
    throw error;
  }
}

/**
 * Trigger a workflow dispatch event
 * @param workflowId The workflow file name or ID
 * @param ref The git reference (branch/tag) to run on
 * @param inputs Optional inputs for the workflow
 */
export async function triggerWorkflowDispatch(
  workflowId: string,
  ref: string,
  inputs?: Record<string, string>
) {
  try {
    // Validate workflow ID to prevent accidental triggers
    if (workflowId !== 'tag-and-push-prod.yaml') {
      throw new Error('Invalid workflow ID - only tag-and-push-prod.yaml is allowed');
    }

    // Validate ref to ensure we only deploy from main
    if (ref !== 'main') {
      throw new Error('Invalid ref - can only deploy from main branch');
    }

    await octokit.actions.createWorkflowDispatch({
      owner,
      repo,
      workflow_id: workflowId,
      ref,
      inputs: {
        ...inputs,
        triggered_by: 'deploybot',
        environment: 'production'
      }
    });
  } catch (error) {
    console.error('Error triggering workflow dispatch:', error);
    throw error;
  }
} 