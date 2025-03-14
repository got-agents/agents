import { WebClient } from '@slack/web-api';

const token = process.env.SLACK_BOT_TOKEN;
const deploymentChannelId = process.env.SLACK_DEPLOYMENT_CHANNEL_ID;

if (!token || !deploymentChannelId) {
  throw new Error('SLACK_BOT_TOKEN and SLACK_DEPLOYMENT_CHANNEL_ID environment variables must be set');
}

const slack = new WebClient(token);

export interface DeploymentRequest {
  tag: string;
  commit: {
    sha: string;
    message: string;
    author: string;
  };
}

/**
 * Send a deployment request message to the configured Slack channel
 */
export async function sendDeploymentRequest(deploymentRequest: DeploymentRequest) {
  const { tag, commit } = deploymentRequest;
  
  await slack.chat.postMessage({
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
export async function sendNewCommitNotification(commit: { sha: string; message: string; author: string }) {
  await slack.chat.postMessage({
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

export { slack }; 