"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { TaskForm } from "@/components/applications/task-form"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import type { Task } from "@/lib/types"

export default function EditTaskPage({ params }: { params: { id: string } }) {
  const router = useRouter()
  const { id } = params
  const [task, setTask] = useState<Task | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const fetchTask = async () => {
      try {
        const response = await fetch(`/api/tasks/${id}`)
        if (response.ok) {
          const data = await response.json()
          setTask(data)
        }
      } catch (error) {
        console.error("Failed to fetch task:", error)
      } finally {
        setIsLoading(false)
      }
    }

    fetchTask()
  }, [id])

  const handleComplete = () => router.push("/dashboard/tasks")
  const handleCancel = () => router.push("/dashboard/tasks")

  if (isLoading) {
    return <div className="space-y-6">Loading...</div>
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
          <CardTitle>Edit Task</CardTitle>
        </CardHeader>
        <CardContent>
          {task && <TaskForm initialData={task} onComplete={handleComplete} onCancel={handleCancel} />}
        </CardContent>
      </Card>
    </div>
  )
}
