import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { DashboardStats } from "@/components/dashboard/dashboard-stats"
import { ApplicationsChart } from "@/components/dashboard/applications-chart"
import { RecentApplications } from "@/components/dashboard/recent-applications"
import { QuickActions } from "@/components/dashboard/quick-actions"
import { UpcomingTasks } from "@/components/dashboard/upcoming-tasks"

export default async function DashboardPage() {
  const supabase = await createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) {
    redirect("/auth/login")
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-balance">Dashboard</h1>
        <p className="text-muted-foreground text-pretty">
          Welcome back! Here&apos;s an overview of your Internship / Job applications.
        </p>
      </div>

      <DashboardStats />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ApplicationsChart />
        <QuickActions />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <RecentApplications />
        <UpcomingTasks />
      </div>
    </div>
  )
}
