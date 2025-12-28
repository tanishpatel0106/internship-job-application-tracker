import "server-only"

import { Resend } from "resend"

let resendClient: Resend | null = null

export const getResendClient = () => {
  const apiKey = process.env.RESEND_API_KEY

  if (!apiKey) {
    return null
  }

  if (!resendClient) {
    resendClient = new Resend(apiKey)
  }

  return resendClient
}

export const getEmailFromAddress = () => {
  return process.env.RESEND_FROM_EMAIL ?? "onboarding@resend.dev"
}
