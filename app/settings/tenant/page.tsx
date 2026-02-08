'use client'

import { useState, useEffect } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { PageHeader } from '@/components/ui/page-header'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { ColorPicker } from '@/components/tenants/color-picker'
import { BrandingPreview } from '@/components/tenants/branding-preview'
import { Badge } from '@/components/ui/badge'
import toast from 'react-hot-toast'
import { Loader2 } from 'lucide-react'

interface TenantConfig {
    id: string
    name: string
    slug: string
    status: string
    created_at: string
    is_personal?: boolean
    branding?: {
        logo_url?: string
        primary_color?: string
        secondary_color?: string
    }
}

interface TenantFeatureStatus {
    id: string
    name: string
    description: string | null
    isEnabled: boolean
    isOverridden: boolean
}

export default function TenantSettingsPage() {
    const [tenant, setTenant] = useState<TenantConfig | null>(null)
    const [features, setFeatures] = useState<TenantFeatureStatus[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [isSaving, setIsSaving] = useState(false)

    // Branding state
    const [logoUrl, setLogoUrl] = useState('')
    const [primaryColor, setPrimaryColor] = useState('#000000')
    const [secondaryColor, setSecondaryColor] = useState('#666666')

    useEffect(() => {
        fetchTenantData()
    }, [])

    const fetchTenantData = async () => {
        try {
            setIsLoading(true)
            // First get the active tenant
            const tenantResponse = await fetch('/api/user/active-tenant')
            if (!tenantResponse.ok) {
                toast.error('Failed to load tenant')
                return
            }

            const tenantData = await tenantResponse.json()

            if (!tenantData.tenant_id) {
                toast.error('No active tenant found')
                return
            }

            // Then get the tenant config
            const configResponse = await fetch(`/api/tenants/${tenantData.tenant_id}/config`)
            if (configResponse.ok) {
                const config = await configResponse.json()
                setTenant(config.tenant)
                setFeatures(config.tenant?.features || config.features || [])

                // Set branding values
                if (config.tenant.branding) {
                    setLogoUrl(config.tenant.branding.logo_url || '')
                    setPrimaryColor(config.tenant.branding.primary_color || '#000000')
                    setSecondaryColor(config.tenant.branding.secondary_color || '#666666')
                }
            }
        } catch (error) {
            console.error('Error fetching tenant:', error)
            toast.error('Failed to load tenant')
        } finally {
            setIsLoading(false)
        }
    }

    const handleSaveBranding = async () => {
        if (!tenant) return

        setIsSaving(true)
        try {
            const response = await fetch(`/api/tenants/${tenant.id}/branding`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    logo_url: logoUrl || null,
                    primary_color: primaryColor,
                    secondary_color: secondaryColor
                })
            })

            if (response.ok) {
                toast.success('Branding updated successfully')
                fetchTenantData()
            } else {
                const data = await response.json()
                toast.error(data.error || 'Failed to update branding')
            }
        } catch (error) {
            console.error('Error saving branding:', error)
            toast.error('Failed to update branding')
        } finally {
            setIsSaving(false)
        }
    }

    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        )
    }

    if (!tenant) {
        return (
            <div className="text-center py-12">
                <p className="text-muted-foreground">No tenant found</p>
            </div>
        )
    }

    const isPersonal = Boolean(tenant.is_personal)

    return (
        <div className="space-y-6">
            <PageHeader
                title="Tenant Settings"
                description="Manage your tenant's branding and configuration"
            />

            <Tabs defaultValue="branding" className="space-y-6">
                <TabsList>
                    <TabsTrigger value="branding">Branding</TabsTrigger>
                    <TabsTrigger value="features">Features</TabsTrigger>
                    <TabsTrigger value="info">Info</TabsTrigger>
                </TabsList>

                <TabsContent value="branding" className="space-y-6">
                    <Card>
                        <CardHeader>
                            <CardTitle>Brand Customization</CardTitle>
                            <CardDescription>
                                Customize your tenant's logo and colors
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            <div className="space-y-2">
                                <Label htmlFor="logo">Logo URL</Label>
                                <Input
                                    id="logo"
                                    placeholder="https://example.com/logo.png"
                                    value={logoUrl}
                                    onChange={(e) => setLogoUrl(e.target.value)}
                                    disabled={isPersonal}
                                />
                                {logoUrl && (
                                    <div className="mt-2">
                                        <img
                                            src={logoUrl}
                                            alt="Logo preview"
                                            className="h-16 w-auto rounded border bg-white object-contain p-2"
                                            onError={() => toast.error('Invalid logo URL')}
                                        />
                                    </div>
                                )}
                            </div>

                            <div className="grid gap-6 sm:grid-cols-2">
                                <div className="space-y-2">
                                    <Label>Primary Color</Label>
                                    <ColorPicker
                                        label="Primary Color"
                                        value={primaryColor}
                                        onChange={setPrimaryColor}
                                        id="primary-color"
                                    />
                                </div>

                                <div className="space-y-2">
                                    <Label>Secondary Color</Label>
                                    <ColorPicker
                                        label="Secondary Color"
                                        value={secondaryColor}
                                        onChange={setSecondaryColor}
                                        id="secondary-color"
                                    />
                                </div>
                            </div>

                            <div className="pt-4">
                                <h3 className="mb-3 text-sm font-medium">Preview</h3>
                                <BrandingPreview
                                    logoUrl={logoUrl}
                                    primaryColor={primaryColor}
                                    secondaryColor={secondaryColor}
                                    tenantName={tenant?.name || 'Tenant'}
                                />
                            </div>

                            <div className="flex items-center justify-between gap-4 pt-4">
                                {isPersonal && (
                                    <p className="text-sm text-muted-foreground">
                                        This is your personal workspace. Branding changes are disabled.
                                    </p>
                                )}
                                <Button onClick={handleSaveBranding} disabled={isSaving || isPersonal}>
                                    {isSaving ? (
                                        <>
                                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                            Saving...
                                        </>
                                    ) : (
                                        'Save Changes'
                                    )}
                                </Button>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="features" className="space-y-6">
                    <Card>
                        <CardHeader>
                            <CardTitle>Feature Flags</CardTitle>
                            <CardDescription>
                                Features enabled for your tenant (managed by super admin)
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            {features.length === 0 ? (
                                <p className="text-sm text-muted-foreground">No features available</p>
                            ) : (
                                <div className="space-y-4">
                                    {features.map((feature) => {
                                        return (
                                            <div
                                                key={feature.id}
                                                className="flex items-center justify-between rounded-lg border p-4"
                                            >
                                                <div className="space-y-1">
                                                    <p className="font-mono text-sm font-semibold">{feature.name}</p>
                                                    {feature.description && (
                                                        <p className="text-sm text-muted-foreground">
                                                            {feature.description}
                                                        </p>
                                                    )}
                                                </div>
                                                <Badge variant={feature.isEnabled ? 'default' : 'secondary'}>
                                                    {feature.isEnabled ? 'Enabled' : 'Disabled'}
                                                </Badge>
                                            </div>
                                        )
                                    })}
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="info" className="space-y-6">
                    <Card>
                        <CardHeader>
                            <CardTitle>Tenant Information</CardTitle>
                            <CardDescription>
                                Read-only information about your tenant
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid gap-4 sm:grid-cols-2">
                                <div className="space-y-1">
                                    <Label className="text-muted-foreground">Tenant ID</Label>
                                    <p className="font-mono text-sm">{tenant.id}</p>
                                </div>

                                <div className="space-y-1">
                                    <Label className="text-muted-foreground">Name</Label>
                                    <p className="text-sm">{tenant.name}</p>
                                </div>

                                <div className="space-y-1">
                                    <Label className="text-muted-foreground">Slug</Label>
                                    <p className="font-mono text-sm">/{tenant.slug}</p>
                                </div>

                                <div className="space-y-1">
                                    <Label className="text-muted-foreground">Status</Label>
                                    <Badge variant={tenant.status === 'active' ? 'default' : 'secondary'}>
                                        {tenant.status}
                                    </Badge>
                                </div>

                                <div className="space-y-1">
                                    <Label className="text-muted-foreground">Created</Label>
                                    <p className="text-sm">
                                        {new Date(tenant.created_at).toLocaleDateString()}
                                    </p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </div>
    )
}
