"use client"

import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Plus, CheckSquare, Calendar, AlertCircle } from "lucide-react"
import { useEffect, useState, useCallback } from "react"
import { TaskForm } from "./task-form"
import type { Task } from "@/lib/types"

interface TasksTabProps {
  applicationId: string
}

const priorityColors = {
  Low: "bg-gray-100 text-gray-800",
  Medium: "bg-blue-100 text-blue-800",
  High: "bg-orange-100 text-orange-800",
  Critical: "bg-red-100 text-red-800",
}

const statusColors = {
  Pending: "bg-yellow-100 text-yellow-800",
  "In Progress": "bg-blue-100 text-blue-800",
  Completed: "bg-green-100 text-green-800",
  Cancelled: "bg-gray-100 text-gray-800",
}

export function TasksTab({ applicationId }: TasksTabProps) {
  const [tasks, setTasks] = useState<Task[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editingTask, setEditingTask] = useState<Task | null>(null)

  const fetchTasks = useCallback(async () => {
    if (!applicationId) return

    try {
      setIsLoading(true)
      setError(null)

      const response = await fetch(`/api/tasks?application_id=${applicationId}`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      })

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      const data = await response.json()
      setTasks(Array.isArray(data) ? data : [])
    } catch (error) {
      console.error("Failed to fetch tasks:", error)
      setError(error instanceof Error ? error.message : "Failed to load tasks")
      setTasks([])
    } finally {
      setIsLoading(false)
    }
  }, [applicationId])

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      fetchTasks()
    }, 100)

    return () => clearTimeout(timeoutId)
  }, [fetchTasks])

  const handleFormComplete = useCallback(() => {
    setShowForm(false)
    setEditingTask(null)
    fetchTasks()
  }, [fetchTasks])

  const markTaskComplete = useCallback(
    async (taskId: string) => {
      try {
        const response = await fetch(`/api/tasks/${taskId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "Completed" }),
        })

        if (response.ok) {
          fetchTasks()
        }
      } catch (error) {
        console.error("Failed to update task:", error)
      }
    },
    [fetchTasks],
  )

  if (isLoading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 2 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="p-6">
              <div className="space-y-2">
                <div className="h-4 bg-muted rounded animate-pulse w-32" />
                <div className="h-3 bg-muted rounded animate-pulse w-48" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <Card>
        <CardContent className="p-12 text-center">
          <AlertCircle className="h-12 w-12 mx-auto mb-4 text-red-500" />
          <h3 className="text-lg font-semibold mb-2 text-red-600">Error Loading Tasks</h3>
          <p className="text-muted-foreground mb-4">{error}</p>
          <Button onClick={fetchTasks} variant="outline">
            Try Again
          </Button>
        </CardContent>
      </Card>
    )
  }

  if (showForm || editingTask) {
    return (
      <TaskForm
        applicationId={applicationId}
        initialData={editingTask}
        onComplete={handleFormComplete}
        onCancel={() => {
          setShowForm(false)
          setEditingTask(null)
        }}
      />
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Tasks</h3>
          <p className="text-sm text-muted-foreground">Track follow-ups and action items</p>
        </div>
        <Button onClick={() => setShowForm(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Add Task
        </Button>
      </div>

      {tasks.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <CheckSquare className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
            <h3 className="text-lg font-semibold mb-2">No tasks added</h3>
            <p className="text-muted-foreground mb-4">Create tasks to stay organized and track your progress.</p>
            <Button onClick={() => setShowForm(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Add Task
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {tasks.map((task) => (
            <Card key={task.id} className="cursor-pointer hover:shadow-md transition-shadow">
              <CardContent className="p-6" onClick={() => setEditingTask(task)}>
                <div className="flex items-start justify-between">
                  <div className="space-y-2 flex-1">
                    <div className="flex items-center gap-2">
                      <h4 className="font-semibold">{task.title}</h4>
                      <Badge className={priorityColors[task.priority]} variant="secondary">
                        {task.priority}
                      </Badge>
                      <Badge className={statusColors[task.status]} variant="secondary">
                        {task.status}
                      </Badge>
                    </div>

                    {task.description && <p className="text-sm text-muted-foreground">{task.description}</p>}

                    {task.due_date && (
                      <div className="flex items-center gap-1 text-sm text-muted-foreground">
                        <Calendar className="h-4 w-4" />
                        Due {new Date(task.due_date).toLocaleDateString()}
                      </div>
                    )}
                  </div>

                  {task.status === "Pending" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={(e) => {
                        e.stopPropagation()
                        markTaskComplete(task.id)
                      }}
                    >
                      <CheckSquare className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
