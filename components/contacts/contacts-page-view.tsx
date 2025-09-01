"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Plus, Search, Mail, Phone, Building, Pencil, Trash, Link as LinkIcon } from "lucide-react"
import Link from "next/link"
import type { Contact } from "@/lib/types"

export function ContactsPageView() {
  const [contacts, setContacts] = useState<Contact[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState("")

  const fetchContacts = async () => {
    setIsLoading(true)
    try {
      const response = await fetch("/api/contacts")
      if (response.ok) {
        const data = await response.json()
        // The contacts API returns a raw array of contacts, not wrapped in a `data` property
        setContacts(Array.isArray(data) ? data : data.data || [])
      }
    } catch (error) {
      console.error("Failed to fetch contacts:", error)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchContacts()
  }, [])

  const handleDelete = async (id: string) => {
    if (!window.confirm("Are you sure you want to delete this contact?")) return
    try {
      const response = await fetch(`/api/contacts/${id}`, { method: "DELETE" })
      if (response.ok) {
        setContacts((prev) => prev.filter((c) => c.id !== id))
      }
    } catch (error) {
      console.error("Failed to delete contact:", error)
    }
  }

  const filteredContacts = contacts.filter(
    (contact) =>
      contact.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (contact.company || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
      (contact.email || "").toLowerCase().includes(searchTerm.toLowerCase()),
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-balance">Contacts</h1>
          <p className="text-muted-foreground text-pretty">Manage all your professional contacts in one place.</p>
        </div>
        <Button asChild>
          <Link href="/dashboard/contacts/new">
            <Plus className="h-4 w-4 mr-2" />
            Add Contact
          </Link>
        </Button>
      </div>

      <div className="flex items-center space-x-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
          <Input
            placeholder="Search contacts..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-6">
                <div className="space-y-3">
                  <div className="h-4 bg-muted rounded animate-pulse" />
                  <div className="h-3 bg-muted rounded animate-pulse w-2/3" />
                  <div className="h-3 bg-muted rounded animate-pulse w-1/2" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : filteredContacts.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <div className="space-y-4">
              <div className="text-muted-foreground">
                {searchTerm ? "No contacts match your search" : "No contacts yet"}
              </div>
              <Button asChild>
                <Link href="/dashboard/contacts/new">
                  <Plus className="h-4 w-4 mr-2" />
                  Add Your First Contact
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredContacts.map((contact) => (
            <Card key={contact.id}>
              <CardHeader>
                <CardTitle className="flex items-start justify-between">
                  <div className="flex items-center space-x-2">
                    <span>{contact.name}</span>
                    {contact.position && <Badge variant="outline">{contact.position}</Badge>}
                  </div>
                  <div className="flex items-center space-x-1">
                    {contact.application_id && (
                      <Button variant="ghost" size="icon" asChild>
                        <Link href={`/dashboard/applications/${contact.application_id}`}>
                          <LinkIcon className="h-4 w-4" />
                        </Link>
                      </Button>
                    )}
                    <Button variant="ghost" size="icon" asChild>
                      <Link href={`/dashboard/contacts/${contact.id}/edit`}>
                        <Pencil className="h-4 w-4" />
                      </Link>
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => handleDelete(contact.id)}>
                      <Trash className="h-4 w-4" />
                    </Button>
                  </div>
                </CardTitle>
                <CardDescription className="flex items-center">
                  <Building className="h-4 w-4 mr-1" />
                  {contact.company}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {contact.email && (
                    <div className="flex items-center text-sm text-muted-foreground">
                      <Mail className="h-4 w-4 mr-2" />
                      <a href={`mailto:${contact.email}`} className="hover:underline">
                        {contact.email}
                      </a>
                    </div>
                  )}
                  {contact.phone && (
                    <div className="flex items-center text-sm text-muted-foreground">
                      <Phone className="h-4 w-4 mr-2" />
                      <a href={`tel:${contact.phone}`} className="hover:underline">
                        {contact.phone}
                      </a>
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
