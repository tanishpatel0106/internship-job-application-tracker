import { useEffect, useState } from "react"
import { ensureTimeZone } from "@/lib/date"

type ProfileResponse = {
  time_zone?: string | null
}

export const useProfileTimeZone = () => {
  const [timeZone, setTimeZone] = useState(() => ensureTimeZone())

  useEffect(() => {
    let isActive = true
    const fetchProfile = async () => {
      try {
        const response = await fetch("/api/profile")
        if (!response.ok) return
        const data: ProfileResponse = await response.json()
        if (isActive) {
          setTimeZone(ensureTimeZone(data.time_zone))
        }
      } catch (error) {
        console.error("Failed to load profile timezone", error)
      }
    }

    fetchProfile()

    return () => {
      isActive = false
    }
  }, [])

  return timeZone
}
