"use client"

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Card, CardContent } from "@/components/ui/card"
import { Edit, Trash2, Eye } from "lucide-react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
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

interface ApplicationsData {
  data: Application[]
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
}

export function ApplicationsTable() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [applications, setApplications] = useState<ApplicationsData>({
    data: [],
    pagination: { page: 1, limit: 10, total: 0, totalPages: 0 },
  })
  const [isLoading, setIsLoading] = useState(true)

  const fetchApplications = async () => {
    setIsLoading(true)
    try {
      const params = new URLSearchParams(searchParams.toString())
      const response = await fetch(`/api/applications?${params.toString()}`)
      if (response.ok) {
        const data = await response.json()
        setApplications(data)
      }
    } catch (error) {
      console.error("Failed to fetch applications:", error)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchApplications()
  }, [searchParams])

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this application?")) return

    try {
      const response = await fetch(`/api/applications/${id}`, {
        method: "DELETE",
      })

      if (response.ok) {
        fetchApplications() // Refresh the list
      }
    } catch (error) {
      console.error("Failed to delete application:", error)
    }
  }

  const handleStatusChange = async (id: string, status: Application["status"]) => {
    try {
      const response = await fetch(`/api/applications/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      })
      if (response.ok) {
        fetchApplications()
      }
    } catch (error) {
      console.error("Failed to update status:", error)
    }
  }

  const handlePageChange = (page: number) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set("page", page.toString())
    router.push(`/dashboard/applications?${params.toString()}`)
  }

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="space-y-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center justify-between p-4 border rounded-lg">
                <div className="space-y-2">
                  <div className="h-4 bg-muted rounded animate-pulse w-48" />
                  <div className="h-3 bg-muted rounded animate-pulse w-32" />
                </div>
                <div className="h-6 bg-muted rounded animate-pulse w-24" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    )
  }

  if (applications.data.length === 0) {
    return (
      <Card>
        <CardContent className="p-12 text-center">
          <div className="space-y-4">
            <div className="text-muted-foreground">
              {searchParams.get("search") || searchParams.get("status")
                ? "No applications match your filters"
                : "No applications yet"}
            </div>
            <Button asChild>
              <Link href="/dashboard/applications/new">Add Your First Application</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Position</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Applied Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Location</TableHead>
                <TableHead className="w-[150px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {applications.data.map((application) => (
                <TableRow key={application.id}>
                  <TableCell>
                    <div>
                      <div className="font-medium">{application.position_title}</div>
                      {application.salary_range && (
                        <div className="text-sm text-muted-foreground">{application.salary_range}</div>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>{application.company_name}</TableCell>
                  <TableCell>{new Date(application.application_date).toLocaleDateString()}</TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Badge
                          className={`${statusColors[application.status]} cursor-pointer`}
                          variant="secondary"
                        >
                          {application.status}
                        </Badge>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start">
                        {Object.keys(statusColors).map((status) => (
                          <DropdownMenuItem
                            key={status}
                            onClick={() =>
                              handleStatusChange(
                                application.id,
                                status as Application["status"]
                              )
                            }
                          >
                            {status}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                  <TableCell>{application.location || "—"}</TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end space-x-2">
                      <Button variant="ghost" size="icon" asChild>
                        <Link href={`/dashboard/applications/${application.id}/details`}>
                          <Eye className="h-4 w-4" />
                        </Link>
                      </Button>
                      <Button variant="ghost" size="icon" asChild>
                        <Link href={`/dashboard/applications/${application.id}/edit`}>
                          <Edit className="h-4 w-4" />
                        </Link>
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDelete(application.id)}
                      >
                        <Trash2 className="h-4 w-4 text-red-600" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {applications.pagination.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            Showing {(applications.pagination.page - 1) * applications.pagination.limit + 1} to{" "}
            {Math.min(applications.pagination.page * applications.pagination.limit, applications.pagination.total)} of{" "}
            {applications.pagination.total} applications
          </div>
          <div className="flex items-center space-x-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => handlePageChange(applications.pagination.page - 1)}
              disabled={applications.pagination.page <= 1}
            >
              Previous
            </Button>
            <div className="flex items-center space-x-1">
              {Array.from({ length: applications.pagination.totalPages }, (_, i) => i + 1)
                .filter((page) => {
                  const current = applications.pagination.page
                  return page === 1 || page === applications.pagination.totalPages || Math.abs(page - current) <= 1
                })
                .map((page, index, array) => (
                  <div key={page} className="flex items-center">
                    {index > 0 && array[index - 1] !== page - 1 && (
                      <span className="px-2 text-muted-foreground">...</span>
                    )}
                    <Button
                      variant={page === applications.pagination.page ? "default" : "outline"}
                      size="sm"
                      onClick={() => handlePageChange(page)}
                      className="w-8 h-8 p-0"
                    >
                      {page}
                    </Button>
                  </div>
                ))}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handlePageChange(applications.pagination.page + 1)}
              disabled={applications.pagination.page >= applications.pagination.totalPages}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
