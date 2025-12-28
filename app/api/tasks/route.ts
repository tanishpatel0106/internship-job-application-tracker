import { createClient } from "@/lib/supabase/server"
import { queueReminderEmail } from "@/lib/email/reminder-preferences"
import { taskSchema } from "@/lib/validations"
import { type NextRequest, NextResponse } from "next/server"
import { z } from "zod"

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const status = searchParams.get("status")
    const applicationId = searchParams.get("application_id")

    let query = supabase.from("tasks").select("*").eq("user_id", user.id).order("created_at", { ascending: false })

    if (status) {
      query = query.eq("status", status)
    }

    if (applicationId) {
      query = query.eq("application_id", applicationId)
    }

    const { data, error } = await query

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(data)
  } catch (error) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
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

    const body = await request.json()
    const validatedData = taskSchema.parse(body)

    const { data, error } = await supabase
      .from("tasks")
      .insert({
        ...validatedData,
        user_id: user.id,
      })
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    if (validatedData.due_date) {
      const { data: preferences } = await supabase
        .from("profiles")
        .select("interview_reminders_enabled, task_reminders_enabled, application_updates_enabled")
        .eq("id", user.id)
        .single()

      await queueReminderEmail({ preferences, type: "task" })
    }

    return NextResponse.json(data, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors }, { status: 400 })
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
