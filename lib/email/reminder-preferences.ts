export type ReminderEmailType = "interview" | "task" | "application-update"

export interface ReminderPreferences {
  interview_reminders_enabled?: boolean | null
  task_reminders_enabled?: boolean | null
  application_updates_enabled?: boolean | null
}

export const shouldSendReminderEmail = (
  preferences: ReminderPreferences | null | undefined,
  type: ReminderEmailType
) => {
  if (!preferences) {
    return true
  }

  switch (type) {
    case "interview":
      return preferences.interview_reminders_enabled ?? true
    case "task":
      return preferences.task_reminders_enabled ?? true
    case "application-update":
      return preferences.application_updates_enabled ?? true
    default:
      return true
  }
}

export const queueReminderEmail = async ({
  preferences,
  type,
}: {
  preferences: ReminderPreferences | null | undefined
  type: ReminderEmailType
}) => {
  if (!shouldSendReminderEmail(preferences, type)) {
    return { queued: false }
  }

  // TODO: Integrate with an email provider or scheduling service.
  return { queued: true }
}
