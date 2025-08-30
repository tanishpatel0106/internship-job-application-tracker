import { createClient } from "@/lib/supabase/server"
import { redirect, notFound } from "next/navigation"
import { ApplicationForm } from "@/components/applications/application-form"

export default async function EditApplicationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    redirect("/auth/login")
  }

  // Fetch the application data
  const { data: application, error } = await supabase
    .from("applications")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .single()

  if (error || !application) {
    notFound()
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-balance">Edit Application</h1>
        <p className="text-muted-foreground text-pretty">
          Update your application for {application.position_title} at {application.company_name}.
        </p>
      </div>
      <ApplicationForm initialData={application} />
    </div>
  )
}
