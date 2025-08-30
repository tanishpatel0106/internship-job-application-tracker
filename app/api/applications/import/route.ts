import { createClient } from "@/lib/supabase/server"
import { applicationSchema } from "@/lib/validations"
import { type NextRequest, NextResponse } from "next/server"
import { z } from "zod"

function parseCSV(csvText: string): string[][] {
  const lines = csvText.split("\n")
  const result: string[][] = []

  for (const line of lines) {
    if (line.trim() === "") continue

    const row: string[] = []
    let current = ""
    let inQuotes = false

    for (let i = 0; i < line.length; i++) {
      const char = line[i]

      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"'
          i++ // Skip next quote
        } else {
          inQuotes = !inQuotes
        }
      } else if (char === "," && !inQuotes) {
        row.push(current.trim())
        current = ""
      } else {
        current += char
      }
    }

    row.push(current.trim())
    result.push(row)
  }

  return result
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const formData = await request.formData()
    const file = formData.get("file") as File

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 })
    }

    const csvText = await file.text()
    const rows = parseCSV(csvText)

    if (rows.length < 2) {
      return NextResponse.json({ error: "CSV file must contain headers and at least one data row" }, { status: 400 })
    }

    const headers = rows[0].map((h) => h.toLowerCase().trim())
    const dataRows = rows.slice(1)

    const requiredFields = ["company name", "position title", "application date", "status"]
    const missingFields = requiredFields.filter((field) => !headers.includes(field))

    if (missingFields.length > 0) {
      return NextResponse.json({ error: `Missing required columns: ${missingFields.join(", ")}` }, { status: 400 })
    }

    const applications = []
    const errors = []

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i]
      const rowData: any = {}

      headers.forEach((header, index) => {
        const value = row[index]?.trim() || ""
        switch (header) {
          case "company name":
            rowData.company_name = value
            break
          case "position title":
            rowData.position_title = value
            break
          case "application date":
            rowData.application_date = value
            break
          case "status":
            rowData.status = value
            break
          case "location":
            rowData.location = value
            break
          case "salary range":
            rowData.salary_range = value
            break
          case "application method":
            rowData.application_method = value
            break
          case "job description":
            rowData.job_description = value
            break
          case "notes":
            rowData.notes = value
            break
        }
      })

      try {
        const validatedData = applicationSchema.parse(rowData)
        applications.push({
          ...validatedData,
          user_id: user.id,
        })
      } catch (error) {
        if (error instanceof z.ZodError) {
          errors.push(`Row ${i + 2}: ${error.errors.map((e) => e.message).join(", ")}`)
        }
      }
    }

    if (errors.length > 0) {
      return NextResponse.json({ error: "Validation errors", details: errors }, { status: 400 })
    }

    const { data, error } = await supabase.from("applications").insert(applications).select()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({
      message: `Successfully imported ${data.length} applications`,
      imported: data.length,
    })
  } catch (error) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
