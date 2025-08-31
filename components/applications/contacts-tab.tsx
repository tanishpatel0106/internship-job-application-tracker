"use client"

import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Plus, Mail, Phone, Building, AlertCircle } from "lucide-react"
import { useEffect, useState, useCallback } from "react"
import { ContactForm } from "./contact-form"
import type { Contact } from "@/lib/types"

interface ContactsTabProps {
  applicationId: string
}

export function ContactsTab({ applicationId }: ContactsTabProps) {
  const [contacts, setContacts] = useState<Contact[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editingContact, setEditingContact] = useState<Contact | null>(null)

  const fetchContacts = useCallback(async () => {
    if (!applicationId) return

    try {
      setIsLoading(true)
      setError(null)

      const response = await fetch(`/api/contacts?application_id=${applicationId}`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      })

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      const data = await response.json()
      setContacts(Array.isArray(data) ? data : [])
    } catch (error) {
      console.error("Failed to fetch contacts:", error)
      setError(error instanceof Error ? error.message : "Failed to load contacts")
      setContacts([])
    } finally {
      setIsLoading(false)
    }
  }, [applicationId])

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      fetchContacts()
    }, 100)

    return () => clearTimeout(timeoutId)
  }, [fetchContacts])

  const handleFormComplete = useCallback(() => {
    setShowForm(false)
    setEditingContact(null)
    fetchContacts()
  }, [fetchContacts])

  if (isLoading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 2 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="p-6">
              <div className="space-y-2">
                <div className="h-4 bg-muted rounded animate-pulse w-32" />
                <div className="h-3 bg-muted rounded animate-pulse w-48" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <Card>
        <CardContent className="p-12 text-center">
          <AlertCircle className="h-12 w-12 mx-auto mb-4 text-red-500" />
          <h3 className="text-lg font-semibold mb-2 text-red-600">Error Loading Contacts</h3>
          <p className="text-muted-foreground mb-4">{error}</p>
          <Button onClick={fetchContacts} variant="outline">
            Try Again
          </Button>
        </CardContent>
      </Card>
    )
  }

  if (showForm || editingContact) {
    return (
      <ContactForm
        applicationId={applicationId}
        initialData={editingContact}
        onComplete={handleFormComplete}
        onCancel={() => {
          setShowForm(false)
          setEditingContact(null)
        }}
      />
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Contacts</h3>
          <p className="text-sm text-muted-foreground">People you've connected with for this application</p>
        </div>
        <Button onClick={() => setShowForm(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Add Contact
        </Button>
      </div>

      {contacts.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <Building className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
            <h3 className="text-lg font-semibold mb-2">No contacts added</h3>
            <p className="text-muted-foreground mb-4">Add contacts to keep track of your network.</p>
            <Button onClick={() => setShowForm(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Add Contact
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {contacts.map((contact) => (
            <Card key={contact.id} className="cursor-pointer hover:shadow-md transition-shadow">
              <CardContent className="p-6" onClick={() => setEditingContact(contact)}>
                <div className="space-y-2">
                  <h4 className="font-semibold">{contact.name}</h4>
                  {contact.position && <p className="text-sm text-muted-foreground">{contact.position}</p>}
                  {contact.company && (
                    <div className="flex items-center gap-1 text-sm text-muted-foreground">
                      <Building className="h-4 w-4" />
                      {contact.company}
                    </div>
                  )}
                  {contact.email && (
                    <div className="flex items-center gap-1 text-sm text-muted-foreground">
                      <Mail className="h-4 w-4" />
                      {contact.email}
                    </div>
                  )}
                  {contact.phone && (
                    <div className="flex items-center gap-1 text-sm text-muted-foreground">
                      <Phone className="h-4 w-4" />
                      {contact.phone}
                    </div>
                  )}
                  {contact.notes && <p className="text-sm text-muted-foreground mt-2">{contact.notes}</p>}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
