import type React from "react"
import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { DashboardNav } from "@/components/dashboard/dashboard-nav"
import type { Profile } from "@/lib/types"

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const { 
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) {
    redirect("/auth/login")
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single<Profile>()

  return (
    <div className="min-h-screen bg-background">
      <DashboardNav user={user} profile={profile} />
      <main className="container mx-auto px-4 py-8">{children}</main>
    </div>
  )
}
