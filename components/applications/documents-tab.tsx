"use client"

import { FileUpload } from "./file-upload"
import { DocumentsList } from "./documents-list"
import { useState } from "react"

interface DocumentsTabProps {
  applicationId: string
}

export function DocumentsTab({ applicationId }: DocumentsTabProps) {
  const [refreshKey, setRefreshKey] = useState(0)

  const handleUploadComplete = () => {
    setRefreshKey((prev) => prev + 1)
  }

  return (
    <div className="space-y-6">
      <FileUpload applicationId={applicationId} onUploadComplete={handleUploadComplete} />
      <DocumentsList applicationId={applicationId} key={refreshKey} />
    </div>
  )
}
