"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { InterviewRoundForm } from "@/components/applications/interview-round-form"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import type { InterviewRound } from "@/lib/types"

export default function EditInterviewPage({ params }: { params: { id: string } }) {
  const router = useRouter()
  const { id } = params
  const [interview, setInterview] = useState<InterviewRound | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const fetchInterview = async () => {
      try {
        const response = await fetch(`/api/interview-rounds/${id}`)
        if (response.ok) {
          const data = await response.json()
          setInterview(data)
        }
      } catch (error) {
        console.error("Failed to fetch interview:", error)
      } finally {
        setIsLoading(false)
      }
    }

    fetchInterview()
  }, [id])

  const handleComplete = () => router.push("/dashboard/interviews")
  const handleCancel = () => router.push("/dashboard/interviews")

  if (isLoading) {
    return <div className="space-y-6">Loading...</div>
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
          <CardTitle>Edit Interview</CardTitle>
        </CardHeader>
        <CardContent>
          {interview && (
            <InterviewRoundForm initialData={interview} onComplete={handleComplete} onCancel={handleCancel} />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
