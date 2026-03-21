'use client'

import Link from 'next/link'
import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { AlertTriangle, RefreshCw, Home } from 'lucide-react'

// Global error boundary for unhandled client errors
export default function GlobalError({
 error,
 reset
}: {
 error: Error & { digest?: string }
 reset: () => void
}) {
 useEffect(() => {
 console.error('Unhandled application error:', error)
 }, [error])

 return (
 <div className="container flex min-h-screen items-center justify-center py-12">
 <Card className="w-full max-w-lg">
 <CardHeader>
 <div className="flex items-center gap-2">
 <AlertTriangle className="size-5 text-destructive" />
 <CardTitle>Something went wrong</CardTitle>
 </div>
 <CardDescription>
 An unexpected error occurred. You can retry or return to the homepage.
 </CardDescription>
 </CardHeader>
 <CardContent className="space-y-2">
 <p className="text-sm text-muted-foreground">
 If the issue persists, please refresh the page or contact an administrator.
 </p>
 {error?.digest && (
 <p className="font-mono text-xs text-muted-foreground">Error ID: {error.digest}</p>
 )}
 </CardContent>
 <CardFooter className="flex gap-2">
 <Button onClick={reset} variant="default" className="flex-1">
 <RefreshCw className="mr-2 size-4" />
 Try Again
 </Button>
 <Button asChild variant="outline" className="flex-1">
 <Link href="/">
 <Home className="mr-2 size-4" />
 Go Home
 </Link>
 </Button>
 </CardFooter>
 </Card>
 </div>
 )
}
