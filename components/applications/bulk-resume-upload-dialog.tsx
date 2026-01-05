"use client"

import type React from "react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { getTodayDateString } from "@/lib/date"
import { useProfileTimeZone } from "@/lib/hooks/use-profile-time-zone"
import type { Application } from "@/lib/types"
import { Upload } from "lucide-react"
import { useState } from "react"

type UploadStatus = "queued" | "uploading" | "success" | "error"

type UploadItem = {
  applicationId: string
  filename: string
  status: UploadStatus
  message?: string
}

interface BulkResumeUploadDialogProps {
  selectedApplications: Application[]
  onUploadComplete?: () => void
  onClearSelection?: () => void
}

const buildUploadPayload = (application: Application, applicationDate: string) => ({
  company_name: application.company_name,
  position_title: application.position_title,
  application_date: applicationDate,
  status: application.status,
  job_description: application.job_description ?? "",
  salary_range: application.salary_range ?? "",
  location: application.location ?? "",
  application_method: application.application_method ?? "",
  notes: application.notes ?? "",
})

export function BulkResumeUploadDialog({
  selectedApplications,
  onUploadComplete,
  onClearSelection,
}: BulkResumeUploadDialogProps) {
  const timeZone = useProfileTimeZone()
  const [files, setFiles] = useState<File[]>([])
  const [uploads, setUploads] = useState<UploadItem[]>([])
  const [isUploading, setIsUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const hasSelection = selectedApplications.length > 0
  const requiresMatchingCount = files.length > 0 && files.length !== selectedApplications.length

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files ? Array.from(e.target.files) : []
    setFiles(selectedFiles)
    setError(null)
    setUploads(
      selectedApplications.map((application, index) => ({
        applicationId: application.id,
        filename: selectedFiles[index]?.name || "No file selected",
        status: "queued",
      }))
    )
    e.target.value = ""
  }

  const updateUpload = (applicationId: string, updates: Partial<UploadItem>) => {
    setUploads((prev) =>
      prev.map((item) => (item.applicationId === applicationId ? { ...item, ...updates } : item))
    )
  }

  const handleUpload = async () => {
    if (!hasSelection || files.length === 0) return
    if (files.length !== selectedApplications.length) {
      setError("Please select the same number of files as selected applications.")
      return
    }

    setIsUploading(true)
    setError(null)
    const applicationDate = getTodayDateString(timeZone)

    for (const [index, application] of selectedApplications.entries()) {
      const file = files[index]
      updateUpload(application.id, { status: "uploading", filename: file.name, message: undefined })

      try {
        const updateResponse = await fetch(`/api/applications/${application.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(buildUploadPayload(application, applicationDate)),
        })

        if (!updateResponse.ok) {
          const errorData = await updateResponse.json()
          throw new Error(errorData.error || "Failed to update application date")
        }

        const formData = new FormData()
        formData.append("file", file)
        formData.append("application_id", application.id)

        const documentResponse = await fetch("/api/documents", {
          method: "POST",
          body: formData,
        })

        if (!documentResponse.ok) {
          const errorData = await documentResponse.json()
          throw new Error(errorData.error || "Failed to upload document")
        }

        updateUpload(application.id, { status: "success" })
      } catch (uploadError) {
        const message = uploadError instanceof Error ? uploadError.message : "Upload failed"
        updateUpload(application.id, { status: "error", message })
        setError("Some uploads failed. Review the list below for details.")
      }
    }

    setIsUploading(false)
    onUploadComplete?.()
    onClearSelection?.()
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={!hasSelection}>
          <Upload className="mr-2 h-4 w-4" />
          Upload resumes
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Upload resumes to selected applications</DialogTitle>
          <DialogDescription>
            Select the same number of files as selected applications. Uploading will set the applied date to today.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Input type="file" multiple onChange={handleFileSelect} accept=".pdf,.doc,.docx,.txt" />

          {requiresMatchingCount && (
            <p className="text-sm text-red-600">
              You selected {selectedApplications.length} applications but {files.length} files. Please match the counts.
            </p>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="rounded-lg border">
            <div className="grid grid-cols-[2fr_1fr_1fr] gap-2 border-b px-3 py-2 text-xs font-semibold uppercase text-muted-foreground">
              <span>Application</span>
              <span>File</span>
              <span>Status</span>
            </div>
            <div className="divide-y">
              {selectedApplications.map((application, index) => {
                const upload = uploads.find((item) => item.applicationId === application.id)
                const fileName = files[index]?.name || upload?.filename || "No file selected"
                return (
                  <div
                    key={application.id}
                    className="grid grid-cols-[2fr_1fr_1fr] gap-2 px-3 py-2 text-sm"
                  >
                    <span className="font-medium">
                      {application.company_name} • {application.position_title}
                    </span>
                    <span className="truncate">{fileName}</span>
                    <span
                      className={
                        upload?.status === "success"
                          ? "text-green-600"
                          : upload?.status === "error"
                            ? "text-red-600"
                            : "text-muted-foreground"
                      }
                    >
                      {upload?.status === "success" && "Uploaded"}
                      {upload?.status === "error" && "Failed"}
                      {upload?.status === "uploading" && "Uploading"}
                      {!upload?.status || upload.status === "queued" ? "Queued" : null}
                    </span>
                    {upload?.message && <span className="col-span-3 text-xs text-red-600">{upload.message}</span>}
                  </div>
                )
              })}
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button onClick={handleUpload} disabled={isUploading || !hasSelection || requiresMatchingCount}>
              {isUploading ? "Uploading..." : "Upload files"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
