import { WebClient } from '@slack/web-api';
import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_CACHE_URL || 'redis://redis:6379/1');
const deploymentChannelId = process.env.SLACK_DEPLOYMENT_CHANNEL_ID;

if (!deploymentChannelId) {
  console.warn('SLACK_DEPLOYMENT_CHANNEL_ID not set - some Slack features will be disabled');
}

// Get bot token from environment if in single-tenant mode
const botToken = process.env.SLACK_BOT_TOKEN;

// Initialize with token if available, or with no token for OAuth flows
export const slack = botToken ? new WebClient(botToken) : new WebClient();

// Helper to get a team-specific Slack client
async function getTeamSlackClient(teamId: string): Promise<WebClient | null> {
  // If in single-tenant mode with a bot token, always use that
  if (botToken) {
    console.log('Using bot token from environment in single-tenant mode');
    return slack;
  }
  
  // Otherwise in multi-tenant mode, look up the token by team ID
  console.log(`Looking up token for team ${teamId} in multi-tenant mode`);
  const tokenData = await redis.get(`slack_token:${teamId}`)
  if (!tokenData) {
    console.error(`No Slack token found for team ${teamId}`);
    return null;
  }
  
  const data = JSON.parse(tokenData)
  return new WebClient(data.access_token)
}

// Helper to get just the token for a team
export async function getTeamToken(teamId: string): Promise<string | null> {
  // If in single-tenant mode with a bot token, always use that
  if (botToken) {
    console.log(`Using environment bot token for team ${teamId} in single-tenant mode`);
    return botToken;
  }
  
  // Otherwise in multi-tenant mode, look up the token by team ID
  console.log(`Attempting to find token for team ${teamId} in Redis`);
  const tokenData = await redis.get(`slack_token:${teamId}`);
  if (!tokenData) {
    console.log(`No token found in Redis for team ${teamId}`);
    return null;
  }
  
  console.log(`Found token in Redis for team ${teamId}`);
  const data = JSON.parse(tokenData);
  return data.access_token;
}

export interface DeploymentRequest {
  tag: string;
  commit: {
    sha: string;
    message: string;
    author: string;
  };
  teamId: string; // Add teamId to know which workspace to send to
}

/**
 * Send a deployment request message to the configured Slack channel
 */
export async function sendDeploymentRequest(deploymentRequest: DeploymentRequest) {
  const { tag, commit, teamId } = deploymentRequest;
  
  const teamSlack = await getTeamSlackClient(teamId)
  if (!teamSlack) {
    throw new Error(`No Slack token found for team ${teamId}`)
  }
  
  await teamSlack.chat.postMessage({
    channel: deploymentChannelId!,
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: "🚀 Production Deployment Request",
          emoji: true
        }
      },
      {
        type: "divider"
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Version:* \`${tag}\`\n*Type:* \`patch\``
        }
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Latest Commit*\n\`${commit.sha.substring(0, 7)}\` ${commit.message}\n_by ${commit.author}_`
        }
      },
      {
        type: "divider"
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "Please review and approve this deployment request."
        }
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: {
              type: "plain_text",
              text: "✅ Approve",
              emoji: true
            },
            style: "primary",
            value: "approve"
          },
          {
            type: "button",
            text: {
              type: "plain_text",
              text: "❌ Reject",
              emoji: true
            },
            style: "danger",
            value: "reject"
          }
        ]
      }
    ]
  });
}

/**
 * Send a notification about new commits to the deployment channel
 */
export async function sendNewCommitNotification(commit: { sha: string; message: string; author: string }, teamId: string) {
  const teamSlack = await getTeamSlackClient(teamId)
  if (!teamSlack) {
    throw new Error(`No Slack token found for team ${teamId}`)
  }

  await teamSlack.chat.postMessage({
    channel: deploymentChannelId!,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `📦 *New commit pushed to main*\n\`${commit.sha.substring(0, 7)}\` ${commit.message}\n_by ${commit.author}_`
        }
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: "Type `deploy` to deploy this commit to production"
          }
        ]
      }
    ]
  });
}