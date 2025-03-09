import { HumanContact, FunctionCall } from "humanlayer"

export type SlackMessage = {
  from_user_id: string
  channel_id: string
  content: string
  message_ts: string
}

export type SlackThread = {
  thread_ts: string
  channel_id: string
  events: SlackMessage[]
}

export type V1Beta2SlackEventReceived = {
  is_test?: boolean
  type: 'agent_slack.received'
  event: SlackThread
}


type EmailMessage = {
  from_address: string
  to_address: string[]
  cc_address: string[]
  bcc_address: string[]
  subject: string
  content: string
  datetime: string
}

type EmailPayload = {
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

export type V1Beta1HumanContactCompleted = {
  is_test: boolean
  event: HumanContact
  type: 'human_contact.completed'
}

export type V1Beta1FunctionCallCompleted = {
  is_test: boolean
  event: FunctionCall
  type: 'function_call.completed'
}