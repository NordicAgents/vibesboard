'use client'

import { useEffect, useState } from 'react'
import type { BookingEnquiryDocument } from '@vibesboard/contracts'

interface Props {
  agentId: string
}

// iso is a wall-clock string ("2026-05-10T14:00") already in the resource's timezone.
// Parse the components directly and format at UTC to avoid any timezone shift.
function fmtDatetime(iso: string, _timezone: string) {
  try {
    const [datePart, timePart = '00:00'] = iso.split('T')
    const [year, month, day] = datePart.split('-').map(Number)
    const [hour, minute] = timePart.split(':').map(Number)
    return new Date(
      Date.UTC(year, month - 1, day, hour, minute || 0)
    ).toLocaleString('en-US', {
      timeZone: 'UTC',
      dateStyle: 'medium',
      timeStyle: 'short'
    })
  } catch {
    return iso
  }
}

function fmtReceived(iso: string) {
  try {
    return new Date(iso).toLocaleString('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short'
    })
  } catch {
    return iso
  }
}

export function AgentBookingEnquiries({ agentId }: Props) {
  const [enquiries, setEnquiries] = useState<BookingEnquiryDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/booking-enquiries?agentId=${agentId}`)
      .then(r => r.json())
      .then(data => {
        if (data.error) throw new Error(data.error)
        setEnquiries(data.enquiries ?? [])
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [agentId])

  if (loading)
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        Loading enquiries...
      </p>
    )
  if (error)
    return <p className="py-8 text-center text-sm text-destructive">{error}</p>
  if (enquiries.length === 0)
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No booking enquiries yet.
      </p>
    )

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th className="pb-2 pr-4 font-medium">Guest</th>
            <th className="pb-2 pr-4 font-medium">Resource</th>
            <th className="pb-2 pr-4 font-medium">Dates</th>
            <th className="pb-2 pr-4 font-medium">Guests</th>
            <th className="pb-2 pr-4 font-medium">Notes</th>
            <th className="pb-2 font-medium">Received</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {enquiries.map(e => (
            <tr key={e.id} className="align-top">
              <td className="py-3 pr-4">
                <p className="font-medium">{e.guestName}</p>
                <p className="text-muted-foreground">{e.guestEmail}</p>
                <p className="text-muted-foreground">{e.guestPhone}</p>
              </td>
              <td className="py-3 pr-4">{e.resourceName}</td>
              <td className="whitespace-nowrap py-3 pr-4">
                <p>{fmtDatetime(e.startDatetime, e.timezone)}</p>
                <p className="text-muted-foreground">
                  → {fmtDatetime(e.endDatetime, e.timezone)}
                </p>
              </td>
              <td className="py-3 pr-4">{e.guestCount ?? '—'}</td>
              <td className="max-w-[160px] py-3 pr-4">
                <p className="truncate text-muted-foreground">
                  {e.notes || '—'}
                </p>
              </td>
              <td className="whitespace-nowrap py-3 text-muted-foreground">
                {fmtReceived(e.createdAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
