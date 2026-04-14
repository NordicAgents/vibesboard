'use client'

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { InvitationDocument } from '@/lib/firestore-types'
import { RoleBadge } from './role-badge'

interface InvitationCardProps {
  invitation: InvitationDocument
  tenantName?: string
  onResend?: () => void
  onRevoke?: () => void
  showActions?: boolean
}

export function InvitationCard({
  invitation,
  tenantName,
  onResend,
  onRevoke,
  showActions = false
}: InvitationCardProps) {
  const isExpired = new Date(invitation.expiresAt) < new Date()
  const isPending = invitation.status === 'pending' && !isExpired

  const statusColors: Record<string, 'default' | 'secondary' | 'destructive'> =
    {
      pending: 'secondary',
      accepted: 'default',
      expired: 'destructive'
    }

  const displayStatus =
    isExpired && invitation.status === 'pending' ? 'expired' : invitation.status

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <CardTitle className="text-base">{invitation.email}</CardTitle>
            {tenantName && <CardDescription>{tenantName}</CardDescription>}
          </div>
          <Badge variant={statusColors[displayStatus]} className="capitalize">
            {displayStatus}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-4 text-sm">
          <div>
            <span className="text-muted-foreground">Role: </span>
            <RoleBadge role={invitation.role} />
          </div>
          <div className="text-muted-foreground">
            Sent {new Date(invitation.createdAt).toLocaleDateString()}
          </div>
        </div>
        {isPending && (
          <div className="mt-2 text-sm text-muted-foreground">
            Expires {new Date(invitation.expiresAt).toLocaleDateString()}
          </div>
        )}
      </CardContent>
      {showActions && (
        <CardFooter className="flex justify-end gap-2">
          {isPending && onResend && (
            <Button variant="outline" size="sm" onClick={onResend}>
              Resend
            </Button>
          )}
          {isPending && onRevoke && (
            <Button variant="destructive" size="sm" onClick={onRevoke}>
              Revoke
            </Button>
          )}
        </CardFooter>
      )}
    </Card>
  )
}
