import express, { Express, Request, Response } from 'express'
import bodyParser from 'body-parser'
import { Webhook } from 'svix'
import { listGitCommits, triggerWorkflowDispatch } from './tools/github'
import { slack } from './tools/slack'
import axios from 'axios'

const debug: boolean = !!process.env.DEBUG
const debugDisableWebhookVerification: boolean = process.env.DEBUG_DISABLE_WEBHOOK_VERIFICATION === 'true'

const app: Express = express()
const port = process.env.PORT || 8000

// Store processed message IDs to prevent duplicates
const processedMessages = new Set<string>();

// Get HumanLayer API key from environment
const HUMANLAYER_API_KEY = process.env.HUMANLAYER_API_KEY_NAME 
  ? process.env[process.env.HUMANLAYER_API_KEY_NAME] 
  : process.env.HUMANLAYER_API_KEY;

if (!HUMANLAYER_API_KEY) {
  throw new Error('HUMANLAYER_API_KEY or HUMANLAYER_API_KEY_NAME environment variable must be set');
}

// Function to create HumanLayer function call
async function createHumanLayerFunctionCall(spec: any) {
  try {
    const response = await axios.post(
      'https://api.dev.humanlayer.dev/humanlayer/v1/function_calls',
      {
        run_id: "deploybot",
        call_id: `deploy-${Date.now()}`,
        spec
      },
      {
        headers: {
          'Authorization': `Bearer ${HUMANLAYER_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
    return response.data;
  } catch (error) {
    console.error('Error creating HumanLayer function call:', error);
    throw error;
  }
}

// Handle Slack events
const handleSlackEvent = async (req: Request, res: Response) => {
  const body = req.body;
  
  // Handle Slack URL verification
  if (body.type === 'url_verification') {
    return res.json({ challenge: body.challenge });
  }

  // Only process message events with text
  if (body.event?.type !== 'message' || !body.event?.text) {
    return res.json({ status: 'ok' });
  }

  const messageId = `${body.event.channel}-${body.event.ts}`;
  
  // Prevent duplicate processing
  if (processedMessages.has(messageId)) {
    return res.json({ status: 'ok' });
  }
  processedMessages.add(messageId);

  // Only process messages containing "deploy prod"
  if (!body.event.text.toLowerCase().includes('deploy prod')) {
    return res.json({ status: 'ok' });
  }

  try {
    // Get latest commit
    const commits = await listGitCommits(1);
    const latestCommit = commits[0];

    if (!latestCommit) {
      await slack.chat.postMessage({
        channel: body.event.channel,
        thread_ts: body.event.thread_ts || body.event.ts,
        text: "❌ No commits found to deploy."
      });
      return res.json({ status: 'ok' });
    }

    // Create deployment request via HumanLayer API
    await createHumanLayerFunctionCall({
      fn: 'deploy_to_prod',
      kwargs: {
        tag: `v${new Date().toISOString().split('T')[0]}`,
        commit: {
          sha: latestCommit.sha,
          message: latestCommit.message,
          author: latestCommit.author
        }
      }
    });

    // Send confirmation that request was created
    await slack.chat.postMessage({
      channel: body.event.channel,
      thread_ts: body.event.thread_ts || body.event.ts,
      text: "🚀 Deployment request created. Please check the deployment channel for approval."
    });

  } catch (error: any) {
    console.error('Error handling deployment request:', error);
    await slack.chat.postMessage({
      channel: body.event.channel,
      thread_ts: body.event.thread_ts || body.event.ts,
      text: `❌ Error: ${error.message}`
    });
  }

  res.json({ status: 'ok' });
};

// Handle HumanLayer webhook responses
const handleHumanLayerWebhook = async (req: Request, res: Response) => {
  const payload = req.body;

  try {
    // Only process function call completions
    if (payload.type === 'function_call.completed') {
      const functionCall = payload.event;
      
      if (functionCall.status?.approved) {
        const { tag, commit } = functionCall.spec.kwargs;
        console.log('tag', tag)
        console.log('commit', commit)
        // Trigger GitHub workflow
        await triggerWorkflowDispatch(
          'tag-and-push-prod.yaml',
          'main',
          {
            type: 'patch',
            semantic_version: tag,
            triggered_by: 'deploybot',
            environment: "staging"
          }
        );

        console.log(`Deployment workflow triggered for tag ${tag} from commit ${commit.sha}`);
      }
    }

    res.json({ status: 'ok' });
  } catch (error: any) {
    console.error('Error processing HumanLayer webhook:', error);
    res.status(500).json({ error: error.message });
  }
};

// Routes
app.post('/webhook/generic', bodyParser.json(), handleSlackEvent);
app.post('/webhook/inbound', bodyParser.json(), handleHumanLayerWebhook);

// Basic health check endpoint
app.get('/health', async (req: Request, res: Response) => {
  res.json({ status: 'ok' })
})

app.get('/', async (req: Request, res: Response) => {
  res.json({
    welcome: 'to the deploybot assistant',
    instructions: 'https://github.com/got-agents/agents',
  })
})

app.use((req: Request, res: Response) => {
  res.status(404).json({
    status: 'error',
    message: 'Not found',
  })
})

// Add after other env var checks
const webhookSecret = process.env.WEBHOOK_SIGNING_SECRET
if (!webhookSecret) {
  console.error('WEBHOOK_SIGNING_SECRET environment variable is required')
  process.exit(1)
}

const wh = new Webhook(webhookSecret)

// Start server
export async function serve() {
  app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
  });
}

// Call serve() if this file is run directly
if (require.main === module) {
  serve().catch(console.error);
}