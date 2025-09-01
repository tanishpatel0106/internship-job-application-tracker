"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { User, Shield, Download, Upload } from "lucide-react"
import type { User as SupabaseUser } from "@supabase/supabase-js"
import type { Profile } from "@/lib/types"

interface SettingsPageViewProps {
  user: SupabaseUser
  profile: Profile | null
}

export function SettingsPageView({ user, profile }: SettingsPageViewProps) {
  const [isUpdating, setIsUpdating] = useState(false)
  const [fullName, setFullName] = useState(profile?.full_name || "")

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
        body: JSON.stringify({ full_name: fullName }),
      })
      if (!res.ok) {
        console.error("Failed to update profile")
      }
    } finally {
      setIsUpdating(false)
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
                  Member since {new Date(user.created_at).toLocaleDateString()}
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
                  Last updated {new Date(user.updated_at || user.created_at).toLocaleDateString()}
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
