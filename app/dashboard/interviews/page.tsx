import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { InterviewsPageView } from "@/components/interviews/interviews-page-view"

export default async function InterviewsPage() {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    redirect("/auth/login")
  }

  return <InterviewsPageView />
}
