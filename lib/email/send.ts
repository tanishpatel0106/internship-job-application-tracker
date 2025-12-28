import { getEmailFromAddress, getResendClient } from "@/lib/email/client"
import { type ReminderPreferences, shouldSendReminderEmail } from "@/lib/email/reminder-preferences"

const DEFAULT_FROM_NAME = "Internship Tracker"

const buildFromAddress = () => {
  return `${DEFAULT_FROM_NAME} <${getEmailFromAddress()}>`
}

const sendEmail = async ({
  to,
  subject,
  text,
}: {
  to: string
  subject: string
  text: string
}) => {
  const resend = getResendClient()

  if (!resend) {
    return { sent: false, reason: "missing_api_key" }
  }

  await resend.emails.send({
    from: buildFromAddress(),
    to,
    subject,
    text,
  })

  return { sent: true }
}

export const sendApplicationCreatedEmail = async ({
  to,
  companyName,
  positionTitle,
  preferences,
}: {
  to: string
  companyName: string
  positionTitle: string
  preferences: ReminderPreferences | null | undefined
}) => {
  if (!shouldSendReminderEmail(preferences, "application-update")) {
    return { sent: false, reason: "disabled" }
  }

  return sendEmail({
    to,
    subject: `Application saved for ${companyName}`,
    text: `Your application for ${positionTitle} at ${companyName} was saved in Internship Tracker.`,
  })
}

export const sendInterviewScheduledEmail = async ({
  to,
  companyName,
  scheduledDate,
  preferences,
}: {
  to: string
  companyName: string
  scheduledDate: string
  preferences: ReminderPreferences | null | undefined
}) => {
  if (!shouldSendReminderEmail(preferences, "interview")) {
    return { sent: false, reason: "disabled" }
  }

  return sendEmail({
    to,
    subject: `Interview scheduled with ${companyName}`,
    text: `Your interview with ${companyName} is scheduled for ${scheduledDate}. We'll remind you ahead of time.`,
  })
}

export const sendInterviewReminderEmail = async ({
  to,
  companyName,
  scheduledDate,
  leadHours,
  preferences,
}: {
  to: string
  companyName: string
  scheduledDate: string
  leadHours: number
  preferences: ReminderPreferences | null | undefined
}) => {
  if (!shouldSendReminderEmail(preferences, "interview")) {
    return { sent: false, reason: "disabled" }
  }

  return sendEmail({
    to,
    subject: `Interview reminder: ${companyName} in ${leadHours} hours`,
    text: `Reminder: your interview with ${companyName} is scheduled for ${scheduledDate} (in ${leadHours} hours).`,
  })
}
