"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { User, Shield, Download, Upload, Bell } from "lucide-react"
import type { User as SupabaseUser } from "@supabase/supabase-js"
import type { Profile } from "@/lib/types"
import { formatDateTimeDisplay } from "@/lib/date"

interface SettingsPageViewProps {
  user: SupabaseUser
  profile: Profile | null
}

export function SettingsPageView({ user, profile }: SettingsPageViewProps) {
  const [isUpdating, setIsUpdating] = useState(false)
  const [isUpdatingPreferences, setIsUpdatingPreferences] = useState(false)
  const [fullName, setFullName] = useState(profile?.full_name || "")
  const [interviewRemindersEnabled, setInterviewRemindersEnabled] = useState(
    profile?.interview_reminders_enabled ?? true
  )
  const [taskRemindersEnabled, setTaskRemindersEnabled] = useState(profile?.task_reminders_enabled ?? true)
  const [applicationUpdatesEnabled, setApplicationUpdatesEnabled] = useState(
    profile?.application_updates_enabled ?? true
  )
  const [timeZone, setTimeZone] = useState(profile?.time_zone || "America/New_York")

  const timeZoneOptions = [
    { value: "America/New_York", label: "Eastern Time (ET)" },
    { value: "America/Chicago", label: "Central Time (CT)" },
    { value: "America/Denver", label: "Mountain Time (MT)" },
    { value: "America/Los_Angeles", label: "Pacific Time (PT)" },
  ]

  const getInitials = (text: string) => {
    return text
      .split(/\s+|@/)
      .filter(Boolean)
      .slice(0, 2)
      .map((s) => s[0])
      .join("")
      .toUpperCase()
  }

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsUpdating(true)
    try {
      const res = await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ full_name: fullName, time_zone: timeZone }),
      })
      if (!res.ok) {
        console.error("Failed to update profile")
      }
    } finally {
      setIsUpdating(false)
    }
  }

  const handleUpdatePreferences = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsUpdatingPreferences(true)
    try {
      const payload: Record<string, unknown> = {
        interview_reminders_enabled: interviewRemindersEnabled,
        task_reminders_enabled: taskRemindersEnabled,
        application_updates_enabled: applicationUpdatesEnabled,
      }
      if (fullName.trim()) {
        payload.full_name = fullName
      }
      const res = await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        console.error("Failed to update reminder preferences")
      }
    } finally {
      setIsUpdatingPreferences(false)
    }
  }

  const handleExportData = async () => {
    try {
      const response = await fetch("/api/applications/export")
      if (response.ok) {
        const blob = await response.blob()
        const url = window.URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.href = url
        a.download = `internship-applications-${new Date().toISOString().split("T")[0]}.csv`
        document.body.appendChild(a)
        a.click()
        window.URL.revokeObjectURL(url)
        document.body.removeChild(a)
      }
    } catch (error) {
      console.error("Failed to export data:", error)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-balance">Settings</h1>
        <p className="text-muted-foreground text-pretty">Manage your account settings and preferences.</p>
      </div>

      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <User className="h-5 w-5 mr-2" />
              Profile Information
            </CardTitle>
            <CardDescription>Your account details and profile information.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center space-x-4">
              <Avatar className="h-16 w-16">
                <AvatarFallback className="text-lg">
                  {getInitials(fullName || user.email || "")}
                </AvatarFallback>
              </Avatar>
              <div>
                <h3 className="font-medium">{fullName || user.email}</h3>
                <p className="text-sm text-muted-foreground">{user.email}</p>
                <p className="text-sm text-muted-foreground">
                  Member since {formatDateTimeDisplay(user.created_at, timeZone, { dateStyle: "medium" })}
                </p>
              </div>
            </div>

            <Separator />

            <form onSubmit={handleUpdateProfile} className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="full_name">Full Name</Label>
                <Input id="full_name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="time_zone">Time Zone</Label>
                <Select value={timeZone} onValueChange={setTimeZone}>
                  <SelectTrigger id="time_zone">
                    <SelectValue placeholder="Select your time zone" />
                  </SelectTrigger>
                  <SelectContent>
                    {timeZoneOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Scheduled interview times will display in this time zone.
                </p>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="email">Email Address</Label>
                <Input id="email" type="email" value={user.email || ""} disabled className="bg-muted" />
                <p className="text-xs text-muted-foreground">
                  Email address cannot be changed. Contact support if you need to update this.
                </p>
              </div>

              <Button type="submit" disabled={isUpdating}>
                {isUpdating ? "Saving..." : "Save Changes"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <Shield className="h-5 w-5 mr-2" />
              Security
            </CardTitle>
            <CardDescription>Manage your account security settings.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="font-medium">Password</h4>
                <p className="text-sm text-muted-foreground">
                  Last updated {formatDateTimeDisplay(user.updated_at || user.created_at, timeZone, { dateStyle: "medium" })}
                </p>
              </div>
              <Button variant="outline" disabled>
                Change Password
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Password management is handled through Supabase authentication. Use the forgot password feature on the
              login page to reset your password.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <Bell className="h-5 w-5 mr-2" />
              Reminders
            </CardTitle>
            <CardDescription>Choose which reminder emails you want to receive.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleUpdatePreferences} className="space-y-4">
              <div className="flex items-start space-x-3">
                <Checkbox
                  id="interview-reminders"
                  checked={interviewRemindersEnabled}
                  onCheckedChange={(checked) => setInterviewRemindersEnabled(Boolean(checked))}
                />
                <div className="space-y-1">
                  <Label htmlFor="interview-reminders">Interview reminders</Label>
                  <p className="text-sm text-muted-foreground">
                    Get notified ahead of scheduled interviews.
                  </p>
                </div>
              </div>

              <div className="flex items-start space-x-3">
                <Checkbox
                  id="task-reminders"
                  checked={taskRemindersEnabled}
                  onCheckedChange={(checked) => setTaskRemindersEnabled(Boolean(checked))}
                />
                <div className="space-y-1">
                  <Label htmlFor="task-reminders">Task reminders</Label>
                  <p className="text-sm text-muted-foreground">
                    Receive email nudges before task due dates.
                  </p>
                </div>
              </div>

              <div className="flex items-start space-x-3">
                <Checkbox
                  id="application-updates"
                  checked={applicationUpdatesEnabled}
                  onCheckedChange={(checked) => setApplicationUpdatesEnabled(Boolean(checked))}
                />
                <div className="space-y-1">
                  <Label htmlFor="application-updates">Application updates</Label>
                  <p className="text-sm text-muted-foreground">
                    Stay in the loop when application statuses change.
                  </p>
                </div>
              </div>

              <Button type="submit" disabled={isUpdatingPreferences}>
                {isUpdatingPreferences ? "Saving..." : "Save Preferences"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <Download className="h-5 w-5 mr-2" />
              Data Management
            </CardTitle>
            <CardDescription>Export or import your application data.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="font-medium">Export Data</h4>
                <p className="text-sm text-muted-foreground">Download all your application data as a CSV file</p>
              </div>
              <Button onClick={handleExportData}>
                <Download className="h-4 w-4 mr-2" />
                Export CSV
              </Button>
            </div>

            <Separator />

            <div className="flex items-center justify-between">
              <div>
                <h4 className="font-medium">Import Data</h4>
                <p className="text-sm text-muted-foreground">Bulk import applications from a CSV file</p>
              </div>
              <Button variant="outline" asChild>
                <a href="/dashboard/applications/import-export">
                  <Upload className="h-4 w-4 mr-2" />
                  Import CSV
                </a>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
