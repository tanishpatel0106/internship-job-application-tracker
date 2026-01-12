"use client"

import type React from "react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import type { Application } from "@/lib/types"
import { getTodayDateString } from "@/lib/date"
import { useProfileTimeZone } from "@/lib/hooks/use-profile-time-zone"

interface ApplicationFormProps {
  initialData?: Application
}

export function ApplicationForm({ initialData }: ApplicationFormProps) {
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const timeZone = useProfileTimeZone()
  const [applications, setApplications] = useState<Application[]>([])
  const [duplicateId, setDuplicateId] = useState("")

  const [formData, setFormData] = useState({
    company_name: initialData?.company_name || "",
    position_title: initialData?.position_title || "",
    application_date: initialData?.application_date || getTodayDateString(timeZone),
    status: initialData?.status || "Applied",
    job_description: initialData?.job_description || "",
    salary_range: initialData?.salary_range || "",
    location: initialData?.location || "",
    application_method: initialData?.application_method || "",
    notes: initialData?.notes || "",
  })

  useEffect(() => {
    if (initialData) return

    const fetchApplications = async () => {
      try {
        const response = await fetch("/api/applications?limit=all&order=desc")
        if (!response.ok) return
        const data = await response.json()
        setApplications(Array.isArray(data.data) ? data.data : [])
      } catch (fetchError) {
        console.error("Failed to load applications for duplication:", fetchError)
      }
    }

    fetchApplications()
  }, [initialData])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError(null)

    try {
      const url = initialData ? `/api/applications/${initialData.id}` : "/api/applications"
      const method = initialData ? "PUT" : "POST"

      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      })

      if (response.ok) {
        router.push("/dashboard/applications")
        router.refresh()
      } else {
        const errorData = await response.json()
        setError(errorData.error || "Failed to save application")
      }
    } catch (error) {
      setError("An unexpected error occurred")
    } finally {
      setIsLoading(false)
    }
  }

  const handleChange = (field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
  }

  const handleDuplicateChange = (applicationId: string) => {
    setDuplicateId(applicationId)
    const selected = applications.find((application) => application.id === applicationId)
    if (!selected) return

    setFormData({
      company_name: selected.company_name,
      position_title: selected.position_title,
      application_date: selected.application_date || getTodayDateString(timeZone),
      status: selected.status,
      job_description: selected.job_description || "",
      salary_range: selected.salary_range || "",
      location: selected.location || "",
      application_method: selected.application_method || "",
      notes: selected.notes || "",
    })
  }

  const handleClearDuplicate = () => {
    setDuplicateId("")
    setFormData({
      company_name: "",
      position_title: "",
      application_date: getTodayDateString(timeZone),
      status: "Applied",
      job_description: "",
      salary_range: "",
      location: "",
      application_method: "",
      notes: "",
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{initialData ? "Edit Application" : "New Application"}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          {!initialData && (
            <div className="space-y-2">
              <Label htmlFor="duplicate_application">Duplicate from previous application</Label>
              <div className="flex flex-col gap-2 md:flex-row md:items-center">
                <div className="w-full md:flex-1">
                  <Select
                    value={duplicateId}
                    onValueChange={handleDuplicateChange}
                    disabled={applications.length === 0}
                  >
                    <SelectTrigger id="duplicate_application">
                      <SelectValue
                        placeholder={
                          applications.length === 0
                            ? "No applications available to duplicate"
                            : "Select an application to prefill"
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {applications.map((application) => (
                        <SelectItem key={application.id} value={application.id}>
                          {application.company_name} • {application.position_title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button type="button" variant="outline" onClick={handleClearDuplicate} disabled={!duplicateId}>
                  Clear
                </Button>
              </div>
              <p className="text-sm text-muted-foreground">
                Copy details from an existing application to speed up creating a new one.
              </p>
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label htmlFor="company_name">Company Name *</Label>
              <Input
                id="company_name"
                value={formData.company_name}
                onChange={(e) => handleChange("company_name", e.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="position_title">Position Title *</Label>
              <Input
                id="position_title"
                value={formData.position_title}
                onChange={(e) => handleChange("position_title", e.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="application_date">Application Date *</Label>
              <Input
                id="application_date"
                type="date"
                value={formData.application_date}
                onChange={(e) => handleChange("application_date", e.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="status">Status *</Label>
              <Select value={formData.status} onValueChange={(value) => handleChange("status", value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Applied">Applied</SelectItem>
                  <SelectItem value="Interview Scheduled">Interview Scheduled</SelectItem>
                  <SelectItem value="Interview Completed">Interview Completed</SelectItem>
                  <SelectItem value="Offer Received">Offer Received</SelectItem>
                  <SelectItem value="Rejected">Rejected</SelectItem>
                  <SelectItem value="Withdrawn">Withdrawn</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="salary_range">Salary Range</Label>
              <Input
                id="salary_range"
                placeholder="e.g., $50,000 - $70,000"
                value={formData.salary_range}
                onChange={(e) => handleChange("salary_range", e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="location">Location</Label>
              <Input
                id="location"
                placeholder="e.g., San Francisco, CA"
                value={formData.location}
                onChange={(e) => handleChange("location", e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="application_method">Application Method</Label>
            <Input
              id="application_method"
              placeholder="e.g., Company website, LinkedIn, Indeed"
              value={formData.application_method}
              onChange={(e) => handleChange("application_method", e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="job_description">Job Description</Label>
            <Textarea
              id="job_description"
              placeholder="Paste the job description here..."
              value={formData.job_description}
              onChange={(e) => handleChange("job_description", e.target.value)}
              rows={4}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              placeholder="Any additional notes about this application..."
              value={formData.notes}
              onChange={(e) => handleChange("notes", e.target.value)}
              rows={3}
            />
          </div>

          {error && <div className="text-sm text-red-600">{error}</div>}

          <div className="flex gap-4">
            <Button type="submit" disabled={isLoading}>
              {isLoading ? "Saving..." : initialData ? "Update Application" : "Create Application"}
            </Button>
            <Button type="button" variant="outline" onClick={() => router.back()}>
              Cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
