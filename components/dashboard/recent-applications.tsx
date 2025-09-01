"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import Link from "next/link"
import { useEffect, useState } from "react"
import type { Application } from "@/lib/types"

const statusColors = {
  Applied: "bg-blue-100 text-blue-800",
  "Interview Scheduled": "bg-green-100 text-green-800",
  "Interview Completed": "bg-yellow-100 text-yellow-800",
  "Offer Received": "bg-emerald-100 text-emerald-800",
  Rejected: "bg-red-100 text-red-800",
  Withdrawn: "bg-gray-100 text-gray-800",
}

export function RecentApplications() {
  const [applications, setApplications] = useState<Application[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const fetchApplications = async () => {
      try {
        const response = await fetch("/api/applications?limit=5")
        if (response.ok) {
          const data = await response.json()
          setApplications(data.data || [])
        }
      } catch (error) {
        console.error("Failed to fetch recent applications:", error)
      } finally {
        setIsLoading(false)
      }
    }

    fetchApplications()
  }, [])

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Recent Applications</CardTitle>
          <CardDescription>Your latest Internship / Job applications</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center justify-between p-3 border rounded-lg">
                <div className="space-y-1">
                  <div className="h-4 bg-muted rounded animate-pulse w-32" />
                  <div className="h-3 bg-muted rounded animate-pulse w-24" />
                </div>
                <div className="h-6 bg-muted rounded animate-pulse w-20" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Recent Applications</CardTitle>
          <CardDescription>Your latest Internship / Job applications</CardDescription>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/dashboard/applications">View All</Link>
        </Button>
      </CardHeader>
      <CardContent>
        {applications.length === 0 ? (
          <div className="text-center py-6">
            <p className="text-muted-foreground">No applications yet</p>
            <Button asChild className="mt-2">
              <Link href="/dashboard/applications/new">Add Your First Application</Link>
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {applications.map((application) => (
              <div key={application.id} className="flex items-center justify-between p-3 border rounded-lg">
                <div>
                  <div className="font-medium">{application.position_title}</div>
                  <div className="text-sm text-muted-foreground">{application.company_name}</div>
                  <div className="text-xs text-muted-foreground">
                    Applied {new Date(application.application_date).toLocaleDateString()}
                  </div>
                </div>
                <Badge className={statusColors[application.status]} variant="secondary">
                  {application.status}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
