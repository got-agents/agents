import { FunctionCall, HumanContact } from 'humanlayer'

export interface EmailMessage {
  from_address: string
  to_address: string[]
  cc_address: string[]
  subject: string
  content: string
  datetime: string
}

export interface EmailPayload {
  from_address: string
  to_address: string
  subject: string
  body: string
  message_id: string
  previous_thread: EmailMessage[]
  raw_email: string
  is_test?: boolean
}

export interface SlackMessage {
  from_user_id: string
  channel_id: string
  content: string
  message_ts: string
}

export interface SlackThread {
  thread_ts: string
  channel_id: string
  events: SlackMessage[]
}

export interface V1Beta1AgentEmailReceived {
  is_test: boolean
  event: EmailPayload
  type: 'agent_email.received'
}

export interface V1Beta2SlackEventReceived {
  is_test: boolean
  event: SlackThread
  type: 'agent_slack.received'
}

export interface V1Beta1HumanContactCompleted {
  is_test: boolean
  event: HumanContact
  type: 'human_contact.completed'
}

export interface V1Beta1FunctionCallCompleted {
  is_test: boolean
  event: FunctionCall
  type: 'function_call.completed'
}
