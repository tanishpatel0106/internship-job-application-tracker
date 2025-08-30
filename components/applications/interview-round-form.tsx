"use client"

import type React from "react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useState } from "react"
import type { InterviewRound } from "@/lib/types"

interface InterviewRoundFormProps {
  applicationId: string
  initialData?: InterviewRound | null
  onComplete: () => void
  onCancel: () => void
}

export function InterviewRoundForm({ applicationId, initialData, onComplete, onCancel }: InterviewRoundFormProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [formData, setFormData] = useState({
    round_number: initialData?.round_number || 1,
    interview_type: initialData?.interview_type || "Phone Screen",
    scheduled_date: initialData?.scheduled_date ? new Date(initialData.scheduled_date).toISOString().slice(0, 16) : "",
    duration_minutes: initialData?.duration_minutes || "",
    interviewer_names: initialData?.interviewer_names || "",
    notes: initialData?.notes || "",
    feedback: initialData?.feedback || "",
    result: initialData?.result || "Not set",
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError(null)

    try {
      const submitData = {
        application_id: applicationId,
        round_number: Number(formData.round_number),
        interview_type: formData.interview_type,
        scheduled_date: formData.scheduled_date || undefined,
        duration_minutes: formData.duration_minutes ? Number(formData.duration_minutes) : undefined,
        interviewer_names: formData.interviewer_names || undefined,
        notes: formData.notes || undefined,
        feedback: formData.feedback || undefined,
        result: formData.result || undefined,
      }

      const url = initialData ? `/api/interview-rounds/${initialData.id}` : "/api/interview-rounds"
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
        setError(errorData.error || "Failed to save interview round")
      }
    } catch (error) {
      setError("An unexpected error occurred")
    } finally {
      setIsLoading(false)
    }
  }

  const handleChange = (field: string, value: string | number) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{initialData ? "Edit Interview Round" : "Add Interview Round"}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label htmlFor="round_number">Round Number *</Label>
              <Input
                id="round_number"
                type="number"
                min="1"
                value={formData.round_number}
                onChange={(e) => handleChange("round_number", Number(e.target.value))}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="interview_type">Interview Type *</Label>
              <Select value={formData.interview_type} onValueChange={(value) => handleChange("interview_type", value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Phone Screen">Phone Screen</SelectItem>
                  <SelectItem value="Technical">Technical</SelectItem>
                  <SelectItem value="Behavioral">Behavioral</SelectItem>
                  <SelectItem value="Panel">Panel</SelectItem>
                  <SelectItem value="Final">Final</SelectItem>
                  <SelectItem value="Other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="scheduled_date">Scheduled Date & Time</Label>
              <Input
                id="scheduled_date"
                type="datetime-local"
                value={formData.scheduled_date}
                onChange={(e) => handleChange("scheduled_date", e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="duration_minutes">Duration (minutes)</Label>
              <Input
                id="duration_minutes"
                type="number"
                min="1"
                value={formData.duration_minutes}
                onChange={(e) => handleChange("duration_minutes", e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="interviewer_names">Interviewer Names</Label>
            <Input
              id="interviewer_names"
              placeholder="e.g., John Smith, Jane Doe"
              value={formData.interviewer_names}
              onChange={(e) => handleChange("interviewer_names", e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="result">Result</Label>
            <Select value={formData.result} onValueChange={(value) => handleChange("result", value)}>
              <SelectTrigger>
                <SelectValue placeholder="Select result" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Not set">Not set</SelectItem>
                <SelectItem value="Passed">Passed</SelectItem>
                <SelectItem value="Failed">Failed</SelectItem>
                <SelectItem value="Pending">Pending</SelectItem>
                <SelectItem value="Cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              placeholder="Interview preparation notes, questions to ask, etc."
              value={formData.notes}
              onChange={(e) => handleChange("notes", e.target.value)}
              rows={3}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="feedback">Feedback</Label>
            <Textarea
              id="feedback"
              placeholder="Post-interview feedback and reflections"
              value={formData.feedback}
              onChange={(e) => handleChange("feedback", e.target.value)}
              rows={3}
            />
          </div>

          {error && <div className="text-sm text-red-600">{error}</div>}

          <div className="flex gap-4">
            <Button type="submit" disabled={isLoading}>
              {isLoading ? "Saving..." : initialData ? "Update Interview" : "Add Interview"}
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
