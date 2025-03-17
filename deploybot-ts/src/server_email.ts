import { V1Beta1AgentEmailReceived } from './vendored'

// Move the email helper functions here
const getAllowedEmails = (): Set<string> => {
  const allowedEmails = process.env.ALLOWED_SOURCE_EMAILS || ''
  return new Set(
    allowedEmails
      .split(',')
      .map(email => email.trim())
      .filter(Boolean),
  )
}

const getTargetEmails = (): Set<string> => {
  const targetEmails = process.env.ALLOWED_TARGET_EMAILS || ''
  return new Set(
    targetEmails
      .split(',')
      .map(email => email.trim())
      .filter(Boolean),
  )
}

export function shouldDropEmail(payload: V1Beta1AgentEmailReceived) {
  if (payload.is_test || payload.event.from_address === 'overworked-admin@coolcompany.com') {
    console.log('test email received, skipping')
    return { status: 'ok', intent: 'test' }
  }

  // Check if email is in "Name <email>" format and extract just the email
  let fromAddress = payload.event.from_address
  const emailMatch = fromAddress.match(/<(.+?)>/)
  if (emailMatch) {
    fromAddress = emailMatch[1]
  }

  // Extract target email from to_address
  let toAddress = payload.event.to_address
  const toEmailMatch = toAddress.match(/<(.+?)>/)
  if (toEmailMatch) {
    toAddress = toEmailMatch[1]
  }

  const allowedEmails = getAllowedEmails()
  const targetEmails = getTargetEmails()
  console.log(`allowedEmails: ${Array.from(allowedEmails).join(',')}`)
  console.log(`targetEmails: ${Array.from(targetEmails).join(',')}`)

  // Check if sender is allowed (if allowlist is configured)
  if (allowedEmails.size > 0 && !allowedEmails.has(fromAddress)) {
    console.log(
      `email from non-allowed sender ${payload.event.from_address} (parsed as ${fromAddress}), skipping`,
    )
    return { status: 'ok', intent: 'meh' }
  }

  // Check if target email is allowed (if target list is configured)
  if (targetEmails.size > 0 && !targetEmails.has(toAddress)) {
    console.log(
      `email to non-target address ${payload.event.to_address} (parsed as ${toAddress}), skipping`,
    )
    return { status: 'ok', intent: 'meh' }
  }

  // If we get here, the email is allowed
  return null
} 