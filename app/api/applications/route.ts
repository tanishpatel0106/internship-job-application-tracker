import { sendApplicationCreatedEmail } from "@/lib/email/send"
import { createClient } from "@/lib/supabase/server"
import { applicationSchema } from "@/lib/validations"
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
    const search = searchParams.get("search")
    const page = Number.parseInt(searchParams.get("page") || "1")
    const limitParam = searchParams.get("limit")
    const limit = limitParam === "all" ? null : Number.parseInt(limitParam || "10")
    const offset = limit ? (page - 1) * limit : 0

    let query = supabase
      .from("applications")
      .select("*", { count: "exact" })
      .eq("user_id", user.id)
      .order("application_date", { ascending: false })

    if (status) {
      query = query.eq("status", status)
    }

    if (search) {
      query = query.or(`company_name.ilike.%${search}%,position_title.ilike.%${search}%`)
    }

    const { data, error, count } = limit
      ? await query.range(offset, offset + limit - 1)
      : await query

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({
      data,
      pagination: {
        page,
        limit: limit ?? count ?? 0,
        total: count || 0,
        totalPages: limit ? Math.ceil((count || 0) / limit) : 1,
      },
    })
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
    const validatedData = applicationSchema.parse(body)

    const { data, error } = await supabase
      .from("applications")
      .insert({
        ...validatedData,
        user_id: user.id,
      })
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    if (user.email) {
      const { data: preferences } = await supabase
        .from("profiles")
        .select("interview_reminders_enabled, task_reminders_enabled, application_updates_enabled")
        .eq("id", user.id)
        .single()

      try {
        await sendApplicationCreatedEmail({
          to: user.email,
          companyName: data.company_name,
          positionTitle: data.position_title,
          preferences,
        })
      } catch (emailError) {
        console.error("Failed to send application email", emailError)
      }
    }

    return NextResponse.json(data, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors }, { status: 400 })
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
