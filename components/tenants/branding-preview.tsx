'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

interface BrandingPreviewProps {
    logoUrl?: string | null
    primaryColor: string
    secondaryColor: string
    tenantName: string
}

export function BrandingPreview({
    logoUrl,
    primaryColor,
    secondaryColor,
    tenantName
}: BrandingPreviewProps) {
    return (
        <Card>
            <CardHeader>
                <CardTitle>Preview</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                {/* Logo Preview */}
                {logoUrl && (
                    <div className="flex items-center justify-center rounded-lg border p-4">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                            src={logoUrl}
                            alt={`${tenantName} logo`}
                            className="h-12 w-auto object-contain"
                            onError={(e) => { e.currentTarget.style.display = 'none' }}
                        />
                    </div>
                )}

                {/* Color Swatches */}
                <div className="space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                        <div>
                            <p className="mb-1 text-sm text-muted-foreground">Primary Color</p>
                            <div
                                className="h-16 rounded-lg border"
                                style={{ backgroundColor: primaryColor }}
                            />
                            <p className="mt-1 font-mono text-xs text-muted-foreground">{primaryColor}</p>
                        </div>
                        <div>
                            <p className="mb-1 text-sm text-muted-foreground">Secondary Color</p>
                            <div
                                className="h-16 rounded-lg border"
                                style={{ backgroundColor: secondaryColor }}
                            />
                            <p className="mt-1 font-mono text-xs text-muted-foreground">{secondaryColor}</p>
                        </div>
                    </div>
                </div>

                {/* Sample UI Preview */}
                <div className="rounded-lg border p-4">
                    <p className="mb-3 text-sm text-muted-foreground">Sample UI</p>
                    <div className="space-y-2">
                        <Button
                            style={{ backgroundColor: primaryColor, color: secondaryColor }}
                            className="w-full"
                        >
                            Primary Button
                        </Button>
                        <Button
                            variant="outline"
                            style={{ borderColor: primaryColor, color: primaryColor }}
                            className="w-full"
                        >
                            Outlined Button
                        </Button>
                    </div>
                </div>
            </CardContent>
        </Card>
    )
}
