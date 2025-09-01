"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { ContactForm } from "@/components/applications/contact-form"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import type { Contact } from "@/lib/types"

export default function EditContactPage({ params }: { params: { id: string } }) {
  const router = useRouter()
  const { id } = params
  const [contact, setContact] = useState<Contact | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const fetchContact = async () => {
      try {
        const response = await fetch(`/api/contacts/${id}`)
        if (response.ok) {
          const data = await response.json()
          setContact(data)
        }
      } catch (error) {
        console.error("Failed to fetch contact:", error)
      } finally {
        setIsLoading(false)
      }
    }

    fetchContact()
  }, [id])

  const handleComplete = () => router.push("/dashboard/contacts")
  const handleCancel = () => router.push("/dashboard/contacts")

  if (isLoading) {
    return <div className="space-y-6">Loading...</div>
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
          <CardTitle>Edit Contact</CardTitle>
        </CardHeader>
        <CardContent>
          {contact && (
            <ContactForm initialData={contact} onComplete={handleComplete} onCancel={handleCancel} />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
