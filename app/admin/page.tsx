import Link from 'next/link'
import { Building2, Flag, FileText, ArrowRight } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export default function AdminPage() {
    return (
        <div className="space-y-8">
            <div>
                <h1 className="text-3xl font-bold">Admin Dashboard</h1>
                <p className="text-muted-foreground mt-2">
                    Manage system-wide settings and monitor operations
                </p>
            </div>

            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                <Link href="/admin/tenants" className="group">
                    <Card className="transition-all hover:shadow-lg hover:border-primary">
                        <CardHeader>
                            <Building2 className="h-8 w-8 mb-2 text-primary" />
                            <CardTitle className="flex items-center justify-between">
                                Tenants
                                <ArrowRight className="h-4 w-4 opacity-0 group-hover:opacity-100 transition-opacity" />
                            </CardTitle>
                            <CardDescription>
                                Manage organizations and their settings
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <p className="text-sm text-muted-foreground">
                                View and configure tenant accounts
                            </p>
                        </CardContent>
                    </Card>
                </Link>

                <Link href="/admin/feature-flags" className="group">
                    <Card className="transition-all hover:shadow-lg hover:border-primary">
                        <CardHeader>
                            <Flag className="h-8 w-8 mb-2 text-primary" />
                            <CardTitle className="flex items-center justify-between">
                                Feature Flags
                                <ArrowRight className="h-4 w-4 opacity-0 group-hover:opacity-100 transition-opacity" />
                            </CardTitle>
                            <CardDescription>
                                Control feature rollouts and experiments
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <p className="text-sm text-muted-foreground">
                                Enable or disable features globally
                            </p>
                        </CardContent>
                    </Card>
                </Link>

                <Link href="/admin/files" className="group">
                    <Card className="transition-all hover:shadow-lg hover:border-primary">
                        <CardHeader>
                            <FileText className="h-8 w-8 mb-2 text-primary" />
                            <CardTitle className="flex items-center justify-between">
                                File Processing
                                <ArrowRight className="h-4 w-4 opacity-0 group-hover:opacity-100 transition-opacity" />
                            </CardTitle>
                            <CardDescription>
                                Monitor RAG file processing status
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <p className="text-sm text-muted-foreground">
                                View and manually trigger file indexing
                            </p>
                        </CardContent>
                    </Card>
                </Link>
            </div>
        </div>
    )
}
