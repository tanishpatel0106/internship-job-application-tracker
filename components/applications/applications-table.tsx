"use client"

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Card, CardContent } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Edit, Trash2, Eye } from "lucide-react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useEffect, useState } from "react"
import type { Application } from "@/lib/types"
import { toast } from "sonner"
import { formatDateOnly } from "@/lib/date"
import { useProfileTimeZone } from "@/lib/hooks/use-profile-time-zone"

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
  const timeZone = useProfileTimeZone()
  const [applications, setApplications] = useState<ApplicationsData>({
    data: [],
    pagination: { page: 1, limit: 10, total: 0, totalPages: 0 },
  })
  const [isLoading, setIsLoading] = useState(true)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [isBulkUpdating, setIsBulkUpdating] = useState(false)

  const bulkStatusActions: Array<{ label: string; status: Application["status"] }> = [
    { label: "Mark Interview Scheduled", status: "Interview Scheduled" },
    { label: "Mark Interview Completed", status: "Interview Completed" },
    { label: "Mark Offer Received", status: "Offer Received" },
    { label: "Mark Rejected", status: "Rejected" },
    { label: "Mark Withdrawn", status: "Withdrawn" },
  ]

  const fetchApplications = async () => {
    setIsLoading(true)
    try {
      const params = new URLSearchParams(searchParams.toString())
      params.set("limit", "all")
      params.delete("page")
      const response = await fetch(`/api/applications?${params.toString()}`)
      if (response.ok) {
        const data = await response.json()
        setApplications(data)
        setSelectedIds((prev) => {
          const validIds = new Set<string>(data.data.map((application: Application) => application.id))
          return new Set([...prev].filter((id) => validIds.has(id)))
        })
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

  const handleBulkStatusChange = async (status: Application["status"]) => {
    if (selectedIds.size === 0) return
    setIsBulkUpdating(true)
    const ids = Array.from(selectedIds)
    try {
      const responses = await Promise.all(
        ids.map((id) =>
          fetch(`/api/applications/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status }),
          })
        )
      )
      const failedCount = responses.filter((response) => !response.ok).length
      if (failedCount > 0) {
        toast.error(`Failed to update ${failedCount} of ${ids.length} applications.`)
      } else {
        toast.success(`Updated ${ids.length} applications to ${status}.`)
      }
      setSelectedIds(new Set())
      fetchApplications()
    } catch (error) {
      console.error("Failed to bulk update applications:", error)
      toast.error("Failed to update selected applications.")
    } finally {
      setIsBulkUpdating(false)
    }
  }

  const toggleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedIds(new Set(applications.data.map((application) => application.id)))
    } else {
      setSelectedIds(new Set())
    }
  }

  const toggleSelectOne = (id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (checked) {
        next.add(id)
      } else {
        next.delete(id)
      }
      return next
    })
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

  const selectedCount = selectedIds.size
  const allSelected = selectedCount > 0 && selectedCount === applications.data.length
  const isIndeterminate = selectedCount > 0 && selectedCount < applications.data.length

  return (
    <div className="space-y-4">
      {selectedCount > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3">
          <div className="text-sm font-medium">{selectedCount} selected</div>
          <div className="flex flex-wrap items-center gap-2">
            {bulkStatusActions.map((action) => (
              <Button
                key={action.status}
                variant="outline"
                size="sm"
                onClick={() => handleBulkStatusChange(action.status)}
                disabled={isBulkUpdating}
              >
                {action.label}
              </Button>
            ))}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelectedIds(new Set())}
              disabled={isBulkUpdating}
            >
              Clear selection
            </Button>
          </div>
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={allSelected ? true : isIndeterminate ? "indeterminate" : false}
                    onCheckedChange={(checked) => toggleSelectAll(checked === true)}
                    aria-label="Select all applications"
                  />
                </TableHead>
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
                  <TableCell className="w-10">
                    <Checkbox
                      checked={selectedIds.has(application.id)}
                      onCheckedChange={(checked) => toggleSelectOne(application.id, checked === true)}
                      aria-label={`Select application for ${application.position_title}`}
                    />
                  </TableCell>
                  <TableCell>
                    <div>
                      <div className="font-medium">{application.position_title}</div>
                      {application.salary_range && (
                        <div className="text-sm text-muted-foreground">{application.salary_range}</div>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>{application.company_name}</TableCell>
                  <TableCell>{formatDateOnly(application.application_date, timeZone)}</TableCell>
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
