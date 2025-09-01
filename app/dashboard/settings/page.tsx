import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { SettingsPageView } from "@/components/settings/settings-page-view"

export default async function SettingsPage() {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    redirect("/auth/login")
  }

  const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).single()

  return <SettingsPageView user={user} profile={profile} />
}
