"use client"

import type React from "react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { getTodayDateString } from "@/lib/date"
import { useProfileTimeZone } from "@/lib/hooks/use-profile-time-zone"
import { Upload } from "lucide-react"
import { useRouter } from "next/navigation"
import { useRef, useState } from "react"

type UploadStatus = "queued" | "uploading" | "success" | "error"

type UploadItem = {
  id: string
  file: File
  status: UploadStatus
  message?: string
}

const buildUploadId = (file: File) => `${file.name}-${file.size}-${file.lastModified}`

const parseFileName = (filename: string) => {
  const baseName = filename.replace(/\.[^/.]+$/, "").trim()
  const parts = baseName.split(/\s*[-–—_|]\s*/).filter(Boolean)

  if (parts.length >= 2) {
    return {
      companyName: parts[0].trim(),
      positionTitle: parts.slice(1).join(" - ").trim() || "Resume Upload",
    }
  }

  return {
    companyName: baseName || "Unknown Company",
    positionTitle: "Resume Upload",
  }
}

export function BulkResumeUpload() {
  const router = useRouter()
  const timeZone = useProfileTimeZone()
  const [uploads, setUploads] = useState<UploadItem[]>([])
  const [isUploading, setIsUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const updateUpload = (id: string, updates: Partial<UploadItem>) => {
    setUploads((prev) => prev.map((item) => (item.id === id ? { ...item, ...updates } : item)))
  }

  const uploadSingle = async (item: UploadItem) => {
    updateUpload(item.id, { status: "uploading", message: undefined })
    const { companyName, positionTitle } = parseFileName(item.file.name)
    const applicationDate = getTodayDateString(timeZone)

    try {
      const applicationResponse = await fetch("/api/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company_name: companyName,
          position_title: positionTitle,
          application_date: applicationDate,
          status: "Applied",
          application_method: "Resume upload",
          notes: `Created from resume upload (${item.file.name}).`,
        }),
      })

      if (!applicationResponse.ok) {
        const errorData = await applicationResponse.json()
        throw new Error(errorData.error || "Failed to create application")
      }

      const application = await applicationResponse.json()

      const formData = new FormData()
      formData.append("file", item.file)
      formData.append("application_id", application.id)

      const documentResponse = await fetch("/api/documents", {
        method: "POST",
        body: formData,
      })

      if (!documentResponse.ok) {
        const errorData = await documentResponse.json()
        throw new Error(errorData.error || "Failed to upload document")
      }

      updateUpload(item.id, { status: "success" })
    } catch (uploadError) {
      const message = uploadError instanceof Error ? uploadError.message : "Upload failed"
      updateUpload(item.id, { status: "error", message })
      setError("Some uploads failed. Review the list below for details.")
    }
  }

  const handleFiles = async (fileList: FileList | File[]) => {
    const selectedFiles = Array.from(fileList)
    if (selectedFiles.length === 0) return

    const newItems = selectedFiles.map((file) => ({
      id: buildUploadId(file),
      file,
      status: "queued" as UploadStatus,
    }))

    setUploads((prev) => [...newItems, ...prev])
    setIsUploading(true)
    setError(null)

    for (const item of newItems) {
      // eslint-disable-next-line no-await-in-loop
      await uploadSingle(item)
    }

    setIsUploading(false)
    router.refresh()
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (files) {
      handleFiles(files)
      e.target.value = ""
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    if (e.dataTransfer.files) {
      handleFiles(e.dataTransfer.files)
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Bulk Resume Upload</CardTitle>
        <CardDescription>
          Upload multiple resumes at once. Each file creates a new application with today&apos;s date as the applied date.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div
          className="border-2 border-dashed border-muted-foreground/25 rounded-lg p-6 text-center hover:border-muted-foreground/50 transition-colors"
          onDrop={handleDrop}
          onDragOver={handleDragOver}
        >
          <Upload className="h-8 w-8 mx-auto mb-4 text-muted-foreground" />
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Drag and drop files here, or click to select multiple resumes.
            </p>
            <Button
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              className="mt-2"
            >
              {isUploading ? "Uploading..." : "Select Files"}
            </Button>
          </div>
          <Input
            ref={fileInputRef}
            type="file"
            multiple
            onChange={handleFileSelect}
            className="hidden"
            accept=".pdf,.doc,.docx,.txt"
          />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        {uploads.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium">Upload status</p>
            <div className="space-y-2">
              {uploads.map((item) => (
                <div key={item.id} className="flex flex-col gap-1 rounded-lg border p-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{item.file.name}</span>
                    <span
                      className={
                        item.status === "success"
                          ? "text-green-600"
                          : item.status === "error"
                            ? "text-red-600"
                            : "text-muted-foreground"
                      }
                    >
                      {item.status === "queued" && "Queued"}
                      {item.status === "uploading" && "Uploading"}
                      {item.status === "success" && "Uploaded"}
                      {item.status === "error" && "Failed"}
                    </span>
                  </div>
                  {item.message && <span className="text-xs text-red-600">{item.message}</span>}
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
