import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"

export async function GET() {
  try {
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { data: applications, error } = await supabase
      .from("applications")
      .select("*")
      .eq("user_id", user.id)
      .order("application_date", { ascending: false })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Convert to CSV
    const headers = [
      "Company Name",
      "Position Title",
      "Application Date",
      "Status",
      "Location",
      "Salary Range",
      "Application Method",
      "Job Description",
      "Notes",
    ]

    const csvRows = [
      headers.join(","),
      ...applications.map((app) =>
        [
          `"${app.company_name}"`,
          `"${app.position_title}"`,
          app.application_date,
          `"${app.status}"`,
          `"${app.location || ""}"`,
          `"${app.salary_range || ""}"`,
          `"${app.application_method || ""}"`,
          `"${(app.job_description || "").replace(/"/g, '""')}"`,
          `"${(app.notes || "").replace(/"/g, '""')}"`,
        ].join(","),
      ),
    ]

    const csvContent = csvRows.join("\n")

    return new Response(csvContent, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="applications-${new Date().toISOString().split("T")[0]}.csv"`,
      },
    })
  } catch (error) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
