"use client"

import { ContactForm } from "@/components/applications/contact-form"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { ArrowLeft } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"

export default function NewContactPage() {
  const router = useRouter()

  const handleComplete = () => {
    router.push("/dashboard/contacts")
  }

  const handleCancel = () => {
    router.push("/dashboard/contacts")
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/dashboard/contacts">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Contacts
          </Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Add New Contact</CardTitle>
        </CardHeader>
        <CardContent>
          <ContactForm onComplete={handleComplete} onCancel={handleCancel} />
        </CardContent>
      </Card>
    </div>
  )
}
