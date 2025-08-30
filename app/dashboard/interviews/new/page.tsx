"use client"

import { InterviewRoundForm } from "@/components/applications/interview-round-form"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { ArrowLeft } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"

export default function NewInterviewPage() {
  const router = useRouter()

  const handleComplete = () => {
    router.push("/dashboard/interviews")
  }

  const handleCancel = () => {
    router.push("/dashboard/interviews")
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/dashboard/interviews">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Interviews
          </Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Schedule New Interview</CardTitle>
        </CardHeader>
        <CardContent>
          <InterviewRoundForm onComplete={handleComplete} onCancel={handleCancel} />
        </CardContent>
      </Card>
    </div>
  )
}
