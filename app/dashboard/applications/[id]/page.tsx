import { createClient } from "@/lib/supabase/server"
import { redirect, notFound } from "next/navigation"

export default async function ApplicationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    redirect("/auth/login")
  }

  // Verify the application exists and belongs to the user
  const { data: application, error } = await supabase
    .from("applications")
    .select("id")
    .eq("id", id)
    .eq("user_id", user.id)
    .single()

  if (error || !application) {
    notFound()
  }

  redirect(`/dashboard/applications/${id}/details`)
}
