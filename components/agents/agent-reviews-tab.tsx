'use client'

import { Input } from '@/components/ui/input'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription
} from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'

interface AgentReviewsTabProps {
  googleReviewEnabled: boolean
  onGoogleReviewEnabledChange: (value: boolean) => void
  googlePlaceId: string
  onGooglePlaceIdChange: (value: string) => void
  saving: boolean
  canEdit: boolean
}

export function AgentReviewsTab({
  googleReviewEnabled,
  onGoogleReviewEnabledChange,
  googlePlaceId,
  onGooglePlaceIdChange,
  saving,
  canEdit
}: AgentReviewsTabProps) {
  return (
    <div className="space-y-5 pb-8">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Google Review</CardTitle>
          <CardDescription>
            Prompt users to leave a Google review after their conversation ends.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <p className="text-sm font-medium">Enable Google Review</p>
              <p className="text-xs text-muted-foreground">
                Show review prompt after chat completion.
              </p>
            </div>
            <Switch
              checked={googleReviewEnabled}
              disabled={saving || !canEdit}
              onCheckedChange={onGoogleReviewEnabledChange}
            />
          </div>
          {googleReviewEnabled && (
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                Google Place ID
              </label>
              <Input
                value={googlePlaceId}
                onChange={e => onGooglePlaceIdChange(e.target.value)}
                placeholder="Leave empty to use tenant default"
                disabled={saving || !canEdit}
              />
              <p className="text-xs text-muted-foreground">
                Override the tenant Place ID for this agent.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
