'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useParams } from 'next/navigation'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

import { Loader2, AlertCircle, CheckCircle2 } from 'lucide-react'
import Link from 'next/link'
import toast from 'react-hot-toast'

interface Invitation {
    id: string
    tenant_id: string
    tenant_name: string
    email: string
    role: string
    status: 'pending' | 'accepted' | 'expired'
    created_at: string
    expires_at: string
    accepted_at: string | null
    invited_by_email: string
}

export default function InvitationPage() {
    const router = useRouter()
    const params = useParams()
    const token = params.token as string

    const [invitation, setInvitation] = useState<Invitation | null>(null)
    const [isLoading, setIsLoading] = useState(true)
    const [isAccepting, setIsAccepting] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [isAuthenticated, setIsAuthenticated] = useState(false)

    useEffect(() => {
        fetchInvitation()
        checkAuth()
    }, [token])

    const checkAuth = async () => {
        try {
            const response = await fetch('/api/user/active-tenant')
            setIsAuthenticated(response.ok)
        } catch (error) {
            setIsAuthenticated(false)
        }
    }

    const fetchInvitation = async () => {
        try {
            setIsLoading(true)
            setError(null)

            const response = await fetch(`/api/invitations/${token}`)

            if (response.ok) {
                const data = await response.json()
                setInvitation(data.invitation)
            } else if (response.status === 404) {
                setError('Invitation not found or has expired')
            } else {
                setError('Failed to load invitation')
            }
        } catch (error) {
            console.error('Error fetching invitation:', error)
            setError('Failed to load invitation')
        } finally {
            setIsLoading(false)
        }
    }

    const handleAccept = async () => {
        if (!isAuthenticated) {
            // Redirect to sign in with return URL
            const returnUrl = `/invite/${token}`
            router.push(`/sign-in?redirectedFrom=${encodeURIComponent(returnUrl)}`)
            return
        }

        setIsAccepting(true)
        try {
            const response = await fetch(`/api/invitations/${token}/accept`, {
                method: 'POST'
            })

            if (response.ok) {
                toast.success('Invitation accepted successfully!')
                setTimeout(() => {
                    router.push('/')
                }, 1500)
            } else {
                const data = await response.json()
                toast.error(data.error || 'Failed to accept invitation')
            }
        } catch (error) {
            console.error('Error accepting invitation:', error)
            toast.error('Failed to accept invitation')
        } finally {
            setIsAccepting(false)
        }
    }

    if (isLoading) {
        return (
            <div className="container flex min-h-screen items-center justify-center">
                <Card className="w-full max-w-md">
                    <CardContent className="flex items-center justify-center py-12">
                        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                    </CardContent>
                </Card>
            </div>
        )
    }

    if (error) {
        return (
            <div className="container flex min-h-screen items-center justify-center">
                <Card className="w-full max-w-md">
                    <CardHeader>
                        <div className="flex items-center gap-2">
                            <AlertCircle className="h-5 w-5 text-destructive" />
                            <CardTitle>Invalid Invitation</CardTitle>
                        </div>
                    </CardHeader>
                    <CardContent>
                        <p className="text-muted-foreground">{error}</p>
                    </CardContent>
                    <CardFooter>
                        <Button asChild className="w-full">
                            <Link href="/">Go to Home</Link>
                        </Button>
                    </CardFooter>
                </Card>
            </div>
        )
    }

    if (!invitation) {
        return null
    }

    const isExpired = new Date(invitation.expires_at) < new Date()
    const isAccepted = invitation.status === 'accepted'

    if (isAccepted) {
        return (
            <div className="container flex min-h-screen items-center justify-center">
                <Card className="w-full max-w-md">
                    <CardHeader>
                        <div className="flex items-center gap-2">
                            <CheckCircle2 className="h-5 w-5 text-green-600" />
                            <CardTitle>Invitation Already Accepted</CardTitle>
                        </div>
                    </CardHeader>
                    <CardContent>
                        <p className="text-muted-foreground">
                            This invitation has already been accepted.
                        </p>
                    </CardContent>
                    <CardFooter>
                        <Button asChild className="w-full">
                            <Link href="/">Go to Home</Link>
                        </Button>
                    </CardFooter>
                </Card>
            </div>
        )
    }

    if (isExpired) {
        return (
            <div className="container flex min-h-screen items-center justify-center">
                <Card className="w-full max-w-md">
                    <CardHeader>
                        <div className="flex items-center gap-2">
                            <AlertCircle className="h-5 w-5 text-destructive" />
                            <CardTitle>Invitation Expired</CardTitle>
                        </div>
                    </CardHeader>
                    <CardContent>
                        <p className="text-muted-foreground">
                            This invitation expired on {new Date(invitation.expires_at).toLocaleDateString()}.
                            Please contact the tenant administrator for a new invitation.
                        </p>
                    </CardContent>
                    <CardFooter>
                        <Button asChild className="w-full">
                            <Link href="/">Go to Home</Link>
                        </Button>
                    </CardFooter>
                </Card>
            </div>
        )
    }

    return (
        <div className="container flex min-h-screen items-center justify-center py-12">
            <div className="w-full max-w-md space-y-6">
                <div className="text-center">
                    <h1 className="text-3xl font-bold">You've Been Invited!</h1>
                    <p className="mt-2 text-muted-foreground">
                        Accept the invitation to join the tenant
                    </p>
                </div>

                <Card>
                    <CardHeader>
                        <CardTitle>{invitation.tenant_name}</CardTitle>
                        <CardDescription>
                            Invited by {invitation.invited_by_email}
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="flex items-center justify-between rounded-lg border p-4">
                            <div className="space-y-0.5">
                                <div className="text-sm font-medium text-muted-foreground">Role</div>
                                <div className="font-medium capitalize">{invitation.role}</div>
                            </div>
                            <div className="space-y-0.5 text-right">
                                <div className="text-sm font-medium text-muted-foreground">Expires</div>
                                <div className="font-medium">
                                    {new Date(invitation.expires_at).toLocaleDateString()}
                                </div>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardContent className="pt-6">
                        {!isAuthenticated ? (
                            <div className="space-y-3">
                                <p className="text-center text-sm text-muted-foreground">
                                    Sign in to accept this invitation
                                </p>
                                <div className="flex flex-col gap-2">
                                    <Button asChild className="w-full">
                                        <Link href={`/sign-in?redirectedFrom=${encodeURIComponent(`/invite/${token}`)}`}>
                                            Sign In to Accept
                                        </Link>
                                    </Button>
                                    <Button asChild variant="outline" className="w-full">
                                        <Link href={`/sign-up?redirectedFrom=${encodeURIComponent(`/invite/${token}`)}`}>
                                            Create Account
                                        </Link>
                                    </Button>
                                </div>
                            </div>
                        ) : (
                            <Button
                                onClick={handleAccept}
                                disabled={isAccepting}
                                className="w-full"
                            >
                                {isAccepting ? (
                                    <>
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        Accepting...
                                    </>
                                ) : (
                                    'Accept Invitation'
                                )}
                            </Button>
                        )}
                    </CardContent>
                </Card>

                <p className="text-center text-xs text-muted-foreground">
                    This invitation will expire on{' '}
                    {new Date(invitation.expires_at).toLocaleDateString()}
                </p>
            </div>
        </div>
    )
}
