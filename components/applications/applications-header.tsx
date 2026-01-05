"use client"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Plus, Search, Filter } from "lucide-react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useState, useEffect } from "react"

export function ApplicationsHeader() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [search, setSearch] = useState(searchParams.get("search") || "")
  const [status, setStatus] = useState(searchParams.get("status") || "")
  const [location, setLocation] = useState(searchParams.get("location") || "")
  const [method, setMethod] = useState(searchParams.get("method") || "")
  const [dateFrom, setDateFrom] = useState(searchParams.get("date_from") || "")
  const [dateTo, setDateTo] = useState(searchParams.get("date_to") || "")
  const [sortBy, setSortBy] = useState(searchParams.get("sort") || "application_date")
  const [sortOrder, setSortOrder] = useState(searchParams.get("order") || "desc")

  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString())

    if (search) {
      params.set("search", search)
    } else {
      params.delete("search")
    }

    if (status) {
      params.set("status", status)
    } else {
      params.delete("status")
    }

    if (location) {
      params.set("location", location)
    } else {
      params.delete("location")
    }

    if (method) {
      params.set("method", method)
    } else {
      params.delete("method")
    }

    if (dateFrom) {
      params.set("date_from", dateFrom)
    } else {
      params.delete("date_from")
    }

    if (dateTo) {
      params.set("date_to", dateTo)
    } else {
      params.delete("date_to")
    }

    if (sortBy) {
      params.set("sort", sortBy)
    } else {
      params.delete("sort")
    }

    if (sortOrder) {
      params.set("order", sortOrder)
    } else {
      params.delete("order")
    }

    params.delete("page") // Reset to first page when filtering

    const newUrl = params.toString() ? `?${params.toString()}` : ""
    router.push(`/dashboard/applications${newUrl}`)
  }, [search, status, location, method, dateFrom, dateTo, sortBy, sortOrder, router, searchParams])

  const handleSearchChange = (value: string) => {
    setSearch(value)
  }

  const handleStatusChange = (value: string) => {
    setStatus(value === "all" ? "" : value)
  }

  const handleSortChange = (value: string) => {
    setSortBy(value)
  }

  const handleSortOrderChange = (value: string) => {
    setSortOrder(value)
  }

  const clearFilters = () => {
    setSearch("")
    setStatus("")
    setLocation("")
    setMethod("")
    setDateFrom("")
    setDateTo("")
  }

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-3xl font-bold text-balance">Applications</h1>
        <p className="text-muted-foreground text-pretty">Manage and track your Internship / Job applications.</p>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search applications..."
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="pl-9 w-64"
            />
          </div>

          <Select value={status || "all"} onValueChange={handleStatusChange}>
            <SelectTrigger className="w-48">
              <Filter className="h-4 w-4 mr-2" />
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="Applied">Applied</SelectItem>
              <SelectItem value="Interview Scheduled">Interview Scheduled</SelectItem>
              <SelectItem value="Interview Completed">Interview Completed</SelectItem>
              <SelectItem value="Offer Received">Offer Received</SelectItem>
              <SelectItem value="Rejected">Rejected</SelectItem>
              <SelectItem value="Withdrawn">Withdrawn</SelectItem>
            </SelectContent>
          </Select>

          {(search || status || location || method || dateFrom || dateTo) && (
            <Button variant="outline" onClick={clearFilters}>
              Clear
            </Button>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <Input
            placeholder="Filter by location..."
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            className="w-48"
          />
          <Input
            placeholder="Filter by method..."
            value={method}
            onChange={(e) => setMethod(e.target.value)}
            className="w-48"
          />
          <Input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="w-40"
          />
          <Input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="w-40"
          />
          <Select value={sortBy} onValueChange={handleSortChange}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="application_date">Applied Date</SelectItem>
              <SelectItem value="company_name">Company Name</SelectItem>
              <SelectItem value="position_title">Position Title</SelectItem>
              <SelectItem value="status">Status</SelectItem>
              <SelectItem value="location">Location</SelectItem>
            </SelectContent>
          </Select>
          <Select value={sortOrder} onValueChange={handleSortOrderChange}>
            <SelectTrigger className="w-36">
              <SelectValue placeholder="Order" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="asc">Ascending</SelectItem>
              <SelectItem value="desc">Descending</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex sm:justify-end">
          <Button asChild>
            <Link href="/dashboard/applications/new">
              <Plus className="h-4 w-4 mr-2" />
              New Application
            </Link>
          </Button>
        </div>
      </div>
    </div>
  )
}
