import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { ContactsPageView } from "@/components/contacts/contacts-page-view"

export default async function ContactsPage() {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    redirect("/auth/login")
  }

  return <ContactsPageView />
}
