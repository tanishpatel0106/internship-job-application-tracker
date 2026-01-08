import type { SupabaseClient } from "@supabase/supabase-js"

import { ensureTimeZone } from "@/lib/date"

export const getUserTimeZone = async (supabase: SupabaseClient, userId: string) => {
  const { data, error } = await supabase.from("profiles").select("time_zone").eq("id", userId).single()
  if (error) {
    return ensureTimeZone()
  }
  return ensureTimeZone(data?.time_zone)
}
