const DEFAULT_TIME_ZONE = "America/New_York"

type DateParts = {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

const getTimeZoneParts = (date: Date, timeZone: string): DateParts => {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })

  const parts = formatter.formatToParts(date)
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]))

  return {
    year: Number(lookup.year),
    month: Number(lookup.month),
    day: Number(lookup.day),
    hour: Number(lookup.hour),
    minute: Number(lookup.minute),
    second: Number(lookup.second),
  }
}

const getTimeZoneOffset = (date: Date, timeZone: string) => {
  const parts = getTimeZoneParts(date, timeZone)
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
  return asUtc - date.getTime()
}

export const ensureTimeZone = (timeZone?: string | null) => {
  return timeZone || DEFAULT_TIME_ZONE
}

export const formatDateTimeForInput = (isoString: string, timeZone: string) => {
  const date = new Date(isoString)
  if (Number.isNaN(date.getTime())) return ""
  const parts = getTimeZoneParts(date, timeZone)
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}T${String(
    parts.hour
  ).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`
}

export const formatDateTimeDisplay = (
  isoString: string,
  timeZone: string,
  options?: Intl.DateTimeFormatOptions
) => {
  const date = new Date(isoString)
  if (Number.isNaN(date.getTime())) return ""
  const formatOptions =
    options ??
    ({
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    } satisfies Intl.DateTimeFormatOptions)
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    ...formatOptions,
  }).format(date)
}

export const zonedTimeToUtcIso = (value: string, timeZone: string) => {
  if (!value) return value
  const [datePart, timePart] = value.split("T")
  if (!datePart || !timePart) return value
  const [year, month, day] = datePart.split("-").map(Number)
  const [hour, minute] = timePart.split(":").map(Number)

  if ([year, month, day, hour, minute].some((part) => Number.isNaN(part))) {
    return value
  }

  const assumedUtc = new Date(Date.UTC(year, month - 1, day, hour, minute, 0))
  const offset = getTimeZoneOffset(assumedUtc, timeZone)
  return new Date(assumedUtc.getTime() - offset).toISOString()
}

export const getDateInTimeZone = (isoString: string, timeZone: string) => {
  const date = new Date(isoString)
  if (Number.isNaN(date.getTime())) return null
  const parts = getTimeZoneParts(date, timeZone)
  return new Date(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
}
