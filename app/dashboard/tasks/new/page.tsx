"use client"

import { TaskForm } from "@/components/applications/task-form"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { ArrowLeft } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"

export default function NewTaskPage() {
  const router = useRouter()

  const handleComplete = () => {
    router.push("/dashboard/tasks")
  }

  const handleCancel = () => {
    router.push("/dashboard/tasks")
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/dashboard/tasks">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Tasks
          </Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Create New Task</CardTitle>
        </CardHeader>
        <CardContent>
          <TaskForm onComplete={handleComplete} onCancel={handleCancel} />
        </CardContent>
      </Card>
    </div>
  )
}
