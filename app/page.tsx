import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { Button } from "@/components/ui/button"
import Link from "next/link"

export default async function HomePage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (user) {
    redirect("/dashboard")
  }

  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-2xl text-center space-y-8">
        <div className="space-y-4">
          <h1 className="text-4xl font-bold text-balance">Internship / Job Application Tracker</h1>
          <p className="text-xl text-muted-foreground text-pretty">
            Organize, track, and manage all your Internship / Job applications in one place. Never miss a deadline or lose
            track of your progress again.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Button asChild size="lg">
            <Link href="/auth/sign-up">Get Started</Link>
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link href="/auth/login">Sign In</Link>
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-12">
          <div className="space-y-2">
            <h3 className="font-semibold">Track Applications</h3>
            <p className="text-sm text-muted-foreground">
              Keep all your applications organized with status tracking and notes
            </p>
          </div>
          <div className="space-y-2">
            <h3 className="font-semibold">Manage Interviews</h3>
            <p className="text-sm text-muted-foreground">Schedule and track interview rounds with detailed feedback</p>
          </div>
          <div className="space-y-2">
            <h3 className="font-semibold">Stay Organized</h3>
            <p className="text-sm text-muted-foreground">Set tasks, deadlines, and never miss important follow-ups</p>
          </div>
        </div>
      </div>
    </div>
  )
}
