'use client'

import Link from 'next/link'
import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle
} from '@/components/ui/card'
import { AlertTriangle, RefreshCw, Plus } from 'lucide-react'

export default function AgentsError({
  error,
  reset
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('Agents page error:', error)
  }, [error])

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="flex items-center gap-2">
            <AlertTriangle className="size-5 text-destructive" />
            <CardTitle className="text-base">Could not load agents</CardTitle>
          </div>
          <CardDescription>
            Something went wrong loading your agents. Check your connection and
            try again.
          </CardDescription>
        </CardHeader>
        {error?.digest && (
          <CardContent>
            <p className="font-mono text-xs text-muted-foreground">
              Error ID: {error.digest}
            </p>
          </CardContent>
        )}
        <CardFooter className="flex gap-2">
          <Button onClick={reset} variant="default" className="flex-1">
            <RefreshCw className="mr-2 size-4" />
            Try Again
          </Button>
          <Button asChild variant="outline" className="flex-1">
            <Link href="/agents/create-chat">
              <Plus className="mr-2 size-4" />
              Create Agent
            </Link>
          </Button>
        </CardFooter>
      </Card>
    </div>
  )
}
