import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { CSVImportExport } from "@/components/applications/csv-import-export"

export default async function ImportExportPage() {
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
        <h1 className="text-3xl font-bold text-balance">Import & Export</h1>
        <p className="text-muted-foreground text-pretty">
          Import applications from CSV files or export your data for backup and analysis.
        </p>
      </div>

      <CSVImportExport />

      <div className="mt-8">
        <h2 className="text-xl font-semibold mb-4">CSV Format Guide</h2>
        <div className="bg-muted p-4 rounded-lg">
          <p className="text-sm text-muted-foreground mb-2">
            Your CSV file should include the following columns (case-insensitive):
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div>
              <h4 className="font-medium">Required Columns:</h4>
              <ul className="list-disc list-inside mt-1 space-y-1">
                <li>Company Name</li>
                <li>Position Title</li>
                <li>Application Date (YYYY-MM-DD format)</li>
                <li>Status (Applied, Interview Scheduled, etc.)</li>
              </ul>
            </div>
            <div>
              <h4 className="font-medium">Optional Columns:</h4>
              <ul className="list-disc list-inside mt-1 space-y-1">
                <li>Location</li>
                <li>Salary Range</li>
                <li>Application Method</li>
                <li>Job Description</li>
                <li>Notes</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
