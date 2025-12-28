import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { Application } from "@/lib/types"
import { ensureTimeZone, formatDateOnly } from "@/lib/date"

interface ApplicationOverviewProps {
  application: Application
}

export function ApplicationOverview({ application }: ApplicationOverviewProps) {
  const timeZone = ensureTimeZone()
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Application Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <h4 className="font-medium text-sm text-muted-foreground">Application Method</h4>
            <p>{application.application_method || "Not specified"}</p>
          </div>
          <div>
            <h4 className="font-medium text-sm text-muted-foreground">Location</h4>
            <p>{application.location || "Not specified"}</p>
          </div>
          <div>
            <h4 className="font-medium text-sm text-muted-foreground">Salary Range</h4>
            <p>{application.salary_range || "Not specified"}</p>
          </div>
          <div>
            <h4 className="font-medium text-sm text-muted-foreground">Applied Date</h4>
            <p>{formatDateOnly(application.application_date, timeZone)}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Notes</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm whitespace-pre-wrap">{application.notes || "No notes added yet."}</p>
        </CardContent>
      </Card>

      {application.job_description && (
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Job Description</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm whitespace-pre-wrap">{application.job_description}</p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
