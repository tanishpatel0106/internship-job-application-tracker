import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { ApplicationForm } from "@/components/applications/application-form"

export default async function NewApplicationPage() {
  const supabase = await createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) {
    redirect("/auth/login")
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-balance">New Application</h1>
        <p className="text-muted-foreground text-pretty">Add a new internship application to track your progress.</p>
      </div>
      <ApplicationForm />
    </div>
  )
}
