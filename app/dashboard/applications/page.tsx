import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { ApplicationsTable } from "@/components/applications/applications-table"
import { ApplicationsHeader } from "@/components/applications/applications-header"
import { BulkResumeUpload } from "@/components/applications/bulk-resume-upload"

export default async function ApplicationsPage() {
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
      <ApplicationsHeader />
      <BulkResumeUpload />
      <ApplicationsTable />
    </div>
  )
}
