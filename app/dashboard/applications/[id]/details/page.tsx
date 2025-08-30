import { createClient } from "@/lib/supabase/server"
import { redirect, notFound } from "next/navigation"
import { ApplicationDetailsView } from "@/components/applications/application-details-view"

export default async function ApplicationDetailsPage({ params }: { params: Promise<{ id: string }> }) {
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

  return <ApplicationDetailsView application={application} />
}
