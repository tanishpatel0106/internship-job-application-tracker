"use client"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Edit, ArrowLeft, Trash2 } from "lucide-react"
import Link from "next/link"
import { useState } from "react"
import { useRouter } from "next/navigation"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { ApplicationOverview } from "./application-overview"
import { InterviewRoundsTab } from "./interview-rounds-tab"
import { ContactsTab } from "./contacts-tab"
import { TasksTab } from "./tasks-tab"
import { DocumentsTab } from "./documents-tab"
import { ApplicationTimeline } from "./application-timeline"
import type { Application } from "@/lib/types"

interface ApplicationDetailsViewProps {
  application: Application
}

const statusColors = {
  Applied: "bg-blue-100 text-blue-800",
  "Interview Scheduled": "bg-green-100 text-green-800",
  "Interview Completed": "bg-yellow-100 text-yellow-800",
  "Offer Received": "bg-emerald-100 text-emerald-800",
  Rejected: "bg-red-100 text-red-800",
  Withdrawn: "bg-gray-100 text-gray-800",
}

export function ApplicationDetailsView({ application }: ApplicationDetailsViewProps) {
  const router = useRouter()
  const [isDeleting, setIsDeleting] = useState(false)

  const handleDelete = async () => {
    setIsDeleting(true)
    try {
      const response = await fetch(`/api/applications/${application.id}`, {
        method: "DELETE",
      })

      if (response.ok) {
        router.push("/dashboard/applications")
        router.refresh()
      } else {
        console.error("Failed to delete application")
      }
    } catch (error) {
      console.error("Error deleting application:", error)
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/dashboard/applications">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Applications
            </Link>
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild>
            <Link href={`/dashboard/applications/${application.id}/edit`}>
              <Edit className="h-4 w-4 mr-2" />
              Edit Application
            </Link>
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" size="sm">
                <Trash2 className="h-4 w-4 mr-2" />
                Delete
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete Application</AlertDialogTitle>
                <AlertDialogDescription>
                  Are you sure you want to delete this application for {application.position_title} at{" "}
                  {application.company_name}? This action cannot be undone and will also delete all related interviews,
                  contacts, tasks, and documents.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleDelete} disabled={isDeleting}>
                  {isDeleting ? "Deleting..." : "Delete Application"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div>
              <CardTitle className="text-2xl">{application.position_title}</CardTitle>
              <CardDescription className="text-lg">{application.company_name}</CardDescription>
            </div>
            <Badge className={statusColors[application.status]} variant="secondary">
              {application.status}
            </Badge>
          </div>
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <span>Applied {new Date(application.application_date).toLocaleDateString()}</span>
            {application.location && <span>• {application.location}</span>}
            {application.salary_range && <span>• {application.salary_range}</span>}
          </div>
        </CardHeader>
      </Card>

      <Tabs defaultValue="overview" className="space-y-6">
        <TabsList className="grid w-full grid-cols-6">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="interviews">Interviews</TabsTrigger>
          <TabsTrigger value="contacts">Contacts</TabsTrigger>
          <TabsTrigger value="tasks">Tasks</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <ApplicationOverview application={application} />
        </TabsContent>

        <TabsContent value="interviews">
          <InterviewRoundsTab applicationId={application.id} />
        </TabsContent>

        <TabsContent value="contacts">
          <ContactsTab applicationId={application.id} />
        </TabsContent>

        <TabsContent value="tasks">
          <TasksTab applicationId={application.id} />
        </TabsContent>

        <TabsContent value="documents">
          <DocumentsTab applicationId={application.id} />
        </TabsContent>

        <TabsContent value="timeline">
          <ApplicationTimeline applicationId={application.id} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
