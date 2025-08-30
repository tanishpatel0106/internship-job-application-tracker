import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { TasksPageView } from "@/components/tasks/tasks-page-view"

export default async function TasksPage() {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    redirect("/auth/login")
  }

  return <TasksPageView />
}
