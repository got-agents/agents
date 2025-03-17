import { HumanContact, FunctionCall } from "humanlayer"

// the rest of this stuff should come from humanlayer sdk
// some exist but are not exported, others are to-be-added

export type SlackMessage = {
  from_user_id: string
  channel_id: string
  content: string
  message_ts: string
  user_id?: string  
  type?: string     
  text?: string
  ts?: string
}

export type SlackThread = {
  thread_ts: string
  channel_id: string
  team_id: string
  events: SlackMessage[]
}


export type EmailMessage = {
  from_address: string
  to_address: string[]
  cc_address: string[]
  bcc_address: string[]
  subject: string
  content: string
  datetime: string
}

export type EmailPayload = {
  from_address: string
  to_address: string
  subject: string
  body: string
  message_id: string
  previous_thread?: EmailMessage[]
  raw_email: string
  is_test?: boolean
}


// vendor these in, should be exported from humanlayer but they're not yet
export type V1Beta1AgentEmailReceived = {
  is_test: boolean
  event: EmailPayload
  type: 'agent_email.received'
}

export type V1Beta2SlackEventReceived = {
  is_test?: boolean
  type: 'agent_slack.received'
  event: SlackThread
}

export type V1Beta1HumanContactCompleted = {
  is_test: boolean
  event: HumanContact
  type: 'human_contact.completed'
}

export interface SlackChannelConfig {
  allowed_responder_ids?: string[];
  bot_token?: string;
  channel_or_user_id: string;
  context_about_channel_or_user?: string;
  experimental_slack_blocks?: boolean;
}

export interface ChannelConfig {
  email?: any;
  slack?: SlackChannelConfig;
  sms?: any;
  whatsapp?: any;
}

export interface FunctionCallSpec {
  fn: string;
  kwargs: Record<string, any>;
  state: any;
  channel?: ChannelConfig;
  reject_options?: Array<{
    description: string;
    interactive: boolean;
    name: string;
    prompt_fill: string;
    title: string;
  }>;
}

export interface FunctionCallOptions {
  run_id?: string;
  call_id: string;
  spec: FunctionCallSpec;
}

export interface V1Beta1FunctionCallCompleted {
  is_test: boolean;
  event: FunctionCall;
  type: 'function_call.completed';
  call_id: string;
  status?: {
    approved?: boolean;
    comment?: string;
  };
  spec: FunctionCallSpec;
}