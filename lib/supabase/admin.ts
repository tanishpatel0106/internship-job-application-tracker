import { createClient } from "@supabase/supabase-js"
import type { SupabaseClient } from "@supabase/supabase-js"

let adminClient: SupabaseClient | null = null

export const createAdminClient = () => {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Supabase service role key is not configured.")
  }

  if (!adminClient) {
    adminClient = createClient(supabaseUrl, serviceRoleKey)
  }

  return adminClient
}
