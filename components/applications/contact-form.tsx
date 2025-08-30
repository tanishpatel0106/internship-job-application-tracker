"use client"

import type React from "react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useState, useEffect } from "react"
import type { Contact, Application } from "@/lib/types"

interface ContactFormProps {
  applicationId?: string
  initialData?: Contact | null
  onComplete: () => void
  onCancel: () => void
}

export function ContactForm({ applicationId, initialData, onComplete, onCancel }: ContactFormProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [applications, setApplications] = useState<Application[]>([])

  const [formData, setFormData] = useState({
    name: initialData?.name || "",
    email: initialData?.email || "",
    phone: initialData?.phone || "",
    position: initialData?.position || "",
    company: initialData?.company || "",
    notes: initialData?.notes || "",
    application_id: applicationId || initialData?.application_id || "default",
  })

  useEffect(() => {
    if (!applicationId) {
      fetchApplications()
    }
  }, [applicationId])

  const fetchApplications = async () => {
    try {
      const response = await fetch("/api/applications")
      if (response.ok) {
        const data = await response.json()
        setApplications(data)
      }
    } catch (error) {
      console.error("Failed to fetch applications:", error)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError(null)

    try {
      const submitData = {
        name: formData.name,
        email: formData.email || undefined,
        phone: formData.phone || undefined,
        position: formData.position || undefined,
        company: formData.company || undefined,
        notes: formData.notes || undefined,
        application_id:
          formData.application_id && formData.application_id !== "default" ? formData.application_id : null,
      }

      const url = initialData ? `/api/contacts/${initialData.id}` : "/api/contacts"
      const method = initialData ? "PUT" : "POST"

      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(submitData),
      })

      if (response.ok) {
        onComplete()
      } else {
        const errorData = await response.json()
        setError(errorData.error || "Failed to save contact")
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

  return (
    <Card>
      <CardHeader>
        <CardTitle>{initialData ? "Edit Contact" : "Add Contact"}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          {!applicationId && (
            <div className="space-y-2">
              <Label htmlFor="application_id">Associated Application (Optional)</Label>
              <Select value={formData.application_id} onValueChange={(value) => handleChange("application_id", value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select an application (optional)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">No application</SelectItem>
                  {applications.map((app) => (
                    <SelectItem key={app.id} value={app.id}>
                      {app.position} at {app.company}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label htmlFor="name">Name *</Label>
              <Input id="name" value={formData.name} onChange={(e) => handleChange("name", e.target.value)} required />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={formData.email}
                onChange={(e) => handleChange("email", e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="phone">Phone</Label>
              <Input
                id="phone"
                type="tel"
                value={formData.phone}
                onChange={(e) => handleChange("phone", e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="position">Position</Label>
              <Input
                id="position"
                value={formData.position}
                onChange={(e) => handleChange("position", e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="company">Company</Label>
            <Input id="company" value={formData.company} onChange={(e) => handleChange("company", e.target.value)} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              placeholder="How you met, conversation notes, etc."
              value={formData.notes}
              onChange={(e) => handleChange("notes", e.target.value)}
              rows={3}
            />
          </div>

          {error && <div className="text-sm text-red-600">{error}</div>}

          <div className="flex gap-4">
            <Button type="submit" disabled={isLoading}>
              {isLoading ? "Saving..." : initialData ? "Update Contact" : "Add Contact"}
            </Button>
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
