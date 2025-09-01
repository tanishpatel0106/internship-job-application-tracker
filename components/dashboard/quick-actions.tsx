"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { FileText, Users, CheckSquare, Calendar } from "lucide-react"
import Link from "next/link"

export function QuickActions() {
  const actions = [
    {
      title: "New Application",
      description: "Add a new Internship / Job application",
      icon: FileText,
      href: "/dashboard/applications/new",
      color: "bg-blue-500",
    },
    {
      title: "Add Contact",
      description: "Save a new contact",
      icon: Users,
      href: "/dashboard/contacts/new",
      color: "bg-green-500",
    },
    {
      title: "Create Task",
      description: "Add a new task or reminder",
      icon: CheckSquare,
      href: "/dashboard/tasks/new",
      color: "bg-orange-500",
    },
    {
      title: "Schedule Interview",
      description: "Add an interview round",
      icon: Calendar,
      href: "/dashboard/interviews/new",
      color: "bg-purple-500",
    },
  ]

  return (
    <Card>
      <CardHeader>
        <CardTitle>Quick Actions</CardTitle>
        <CardDescription>Common tasks to help you stay organized</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-4">
          {actions.map((action) => {
            const Icon = action.icon
            return (
              <Button
                key={action.title}
                asChild
                variant="outline"
                className="h-auto p-4 flex-col items-start bg-transparent"
              >
                <Link href={action.href}>
                  <div className="flex items-center gap-2 mb-2">
                    <div className={`p-2 rounded-md ${action.color}`}>
                      <Icon className="h-4 w-4 text-white" />
                    </div>
                  </div>
                  <div className="text-left">
                    <div className="font-medium">{action.title}</div>
                    <div className="text-xs text-muted-foreground">{action.description}</div>
                  </div>
                </Link>
              </Button>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
