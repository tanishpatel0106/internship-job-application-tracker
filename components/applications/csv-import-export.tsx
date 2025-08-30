"use client"

import type React from "react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Download, Upload } from "lucide-react"
import { useState, useRef } from "react"

interface CSVImportExportProps {
  onImportComplete?: () => void
}

export function CSVImportExport({ onImportComplete }: CSVImportExportProps) {
  const [isImporting, setIsImporting] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [importResult, setImportResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleExport = async () => {
    setIsExporting(true)
    try {
      const response = await fetch("/api/applications/export")
      if (response.ok) {
        const blob = await response.blob()
        const url = window.URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.href = url
        a.download = `applications-${new Date().toISOString().split("T")[0]}.csv`
        document.body.appendChild(a)
        a.click()
        window.URL.revokeObjectURL(url)
        document.body.removeChild(a)
      } else {
        setError("Export failed")
      }
    } catch (error) {
      setError("Export failed")
    } finally {
      setIsExporting(false)
    }
  }

  const handleImport = async (file: File) => {
    setIsImporting(true)
    setError(null)
    setImportResult(null)

    try {
      const formData = new FormData()
      formData.append("file", file)

      const response = await fetch("/api/applications/import", {
        method: "POST",
        body: formData,
      })

      const result = await response.json()

      if (response.ok) {
        setImportResult(result.message)
        onImportComplete?.()
      } else {
        setError(result.error + (result.details ? `\n${result.details.join("\n")}` : ""))
      }
    } catch (error) {
      setError("Import failed")
    } finally {
      setIsImporting(false)
    }
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      handleImport(file)
    }
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Download className="h-5 w-5" />
            Export Applications
          </CardTitle>
          <CardDescription>Download your applications as a CSV file</CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={handleExport} disabled={isExporting} className="w-full">
            {isExporting ? "Exporting..." : "Export to CSV"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            Import Applications
          </CardTitle>
          <CardDescription>Upload a CSV file to bulk import applications</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={isImporting}
            className="w-full"
          >
            {isImporting ? "Importing..." : "Select CSV File"}
          </Button>
          <Input ref={fileInputRef} type="file" onChange={handleFileSelect} className="hidden" accept=".csv" />

          <div className="text-xs text-muted-foreground">
            <p className="font-medium mb-1">Required columns:</p>
            <ul className="list-disc list-inside space-y-1">
              <li>Company Name</li>
              <li>Position Title</li>
              <li>Application Date (YYYY-MM-DD)</li>
              <li>Status</li>
            </ul>
            <p className="mt-2">Optional: Location, Salary Range, Application Method, Job Description, Notes</p>
          </div>

          {importResult && <div className="text-sm text-green-600 bg-green-50 p-2 rounded">{importResult}</div>}
          {error && <div className="text-sm text-red-600 bg-red-50 p-2 rounded whitespace-pre-wrap">{error}</div>}
        </CardContent>
      </Card>
    </div>
  )
}
