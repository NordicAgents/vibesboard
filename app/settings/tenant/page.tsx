'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card'
import { PageHeader } from '@/components/ui/page-header'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { ColorPicker } from '@/components/tenants/color-picker'
import { BrandingPreview } from '@/components/tenants/branding-preview'
import { LogoUpload } from '@/components/tenants/logo-upload'
import { FeatureToggle } from '@/components/tenants/feature-toggle'
import { Badge } from '@/components/ui/badge'
import toast from 'react-hot-toast'
import { Loader2, RotateCcw } from 'lucide-react'
import {
  normalizeHex,
  hexToHslParts,
  hexToRgbParts,
  toCssHslVar
} from '@/lib/colors'

interface TenantConfig {
  id: string
  name: string
  slug: string
  status: string
  created_at: string
  is_personal?: boolean
  googlePlaceId?: string | null
  branding?: {
    logoUrl?: string
    primaryColor?: string
    secondaryColor?: string
  }
}

interface BaseBranding {
  logoUrl?: string
  primaryColor: string
  secondaryColor: string
}

type BrandingField = 'logoUrl' | 'primaryColor' | 'secondaryColor'

interface TenantFeatureStatus {
  id: string
  name: string
  description: string | null
  isEnabled: boolean
  isOverridden: boolean
  parentFlagName: string | null
  isDisabledByParent: boolean
}

/** Apply brand CSS vars directly to document.body — mirrors getActiveTenantTheme on server. */
function applyBrandCssVars(primary: string, secondary: string) {
  const primaryHex = normalizeHex(primary)
  const secondaryHex = normalizeHex(secondary)
  if (!primaryHex || !secondaryHex) {
    console.warn('applyBrandCssVars: invalid hex value(s)', { primary, secondary })
    return
  }

  const primaryHsl = toCssHslVar(hexToHslParts(primaryHex))
  const secondaryHsl = toCssHslVar(hexToHslParts(secondaryHex))
  const { r, g, b } = hexToRgbParts(primaryHex)

  document.body.style.setProperty('--accent-orange', primaryHex)
  document.body.style.setProperty('--accent-warm', primaryHex)
  document.body.style.setProperty('--accent-glow', `rgba(${r}, ${g}, ${b}, 0.24)`)
  document.body.style.setProperty('--primary', primaryHsl)
  document.body.style.setProperty('--primary-foreground', secondaryHsl)
  document.body.style.setProperty('--ring', primaryHsl)
}

export default function TenantSettingsPage() {
  const router = useRouter()
  const [tenant, setTenant] = useState<TenantConfig | null>(null)
  const [features, setFeatures] = useState<TenantFeatureStatus[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isResetting, setIsResetting] = useState(false)

  // Branding state
  const [logoUrl, setLogoUrl] = useState('')
  const [primaryColor, setPrimaryColor] = useState('#000000')
  const [secondaryColor, setSecondaryColor] = useState('#ffffff')

  // Base branding & overrides from API
  const [baseBranding, setBaseBranding] = useState<BaseBranding | null>(null)
  const [overrides, setOverrides] = useState<BrandingField[] | null>(null)

  // Google Review state
  const [googlePlaceId, setGooglePlaceId] = useState('')
  const [isSavingGoogleReview, setIsSavingGoogleReview] = useState(false)

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
      const configResponse = await fetch(
        `/api/tenants/${tenantData.tenant_id}/config`
      )
      if (configResponse.ok) {
        const config = await configResponse.json()
        setTenant(config.tenant)
        setFeatures(config.tenant?.features || config.features || [])

        // Set base branding & overrides
        if (config.baseBranding) {
          setBaseBranding(config.baseBranding)
        }
        if (config.overrides !== undefined) {
          setOverrides(config.overrides)
        }

        // Set branding values (config now returns resolved effective branding)
        if (config.tenant.branding) {
          setLogoUrl(config.tenant.branding.logoUrl || '')
          setPrimaryColor(config.tenant.branding.primaryColor || '#000000')
          setSecondaryColor(config.tenant.branding.secondaryColor || '#ffffff')
        }
        if (config.tenant.googlePlaceId) {
          setGooglePlaceId(config.tenant.googlePlaceId)
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
          logoUrl: logoUrl || null,
          primaryColor,
          secondaryColor
        })
      })

      if (response.ok) {
        const data = await response.json()
        if (data.overrides !== undefined) setOverrides(data.overrides)
        if (data.baseBranding) setBaseBranding(data.baseBranding)
        // Apply CSS vars immediately client-side so the UI updates without a reload.
        // router.refresh() syncs the server-rendered layout for subsequent navigations.
        applyBrandCssVars(primaryColor, secondaryColor)
        toast.success('Branding updated successfully')
        router.refresh()
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

  const handleResetBranding = async () => {
    if (!tenant) return

    setIsResetting(true)
    try {
      const response = await fetch(
        `/api/tenants/${tenant.id}/branding/reset`,
        { method: 'POST' }
      )

      if (response.ok) {
        const data = await response.json()
        if (data.branding) {
          setLogoUrl(data.branding.logoUrl || '')
          setPrimaryColor(data.branding.primaryColor || '#000000')
          setSecondaryColor(data.branding.secondaryColor || '#ffffff')
          applyBrandCssVars(
            data.branding.primaryColor || '#000000',
            data.branding.secondaryColor || '#ffffff'
          )
        }
        if (data.baseBranding) setBaseBranding(data.baseBranding)
        setOverrides(data.overrides ?? [])
        toast.success('Branding reset to platform defaults')
        router.refresh()
      } else {
        const data = await response.json()
        toast.error(data.error || 'Failed to reset branding')
      }
    } catch (error) {
      console.error('Error resetting branding:', error)
      toast.error('Failed to reset branding')
    } finally {
      setIsResetting(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!tenant) {
    return (
      <div className="py-12 text-center">
        <p className="text-muted-foreground">No tenant found</p>
      </div>
    )
  }

  const handleSaveGoogleReview = async () => {
    if (!tenant) return

    setIsSavingGoogleReview(true)
    try {
      const response = await fetch(`/api/tenants/${tenant.id}/google-review`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ googlePlaceId: googlePlaceId || null })
      })

      if (response.ok) {
        toast.success('Google Review settings updated')
        fetchTenantData()
      } else {
        const data = await response.json()
        toast.error(data.error || 'Failed to update Google Review settings')
      }
    } catch (error) {
      console.error('Error saving Google Review:', error)
      toast.error('Failed to update Google Review settings')
    } finally {
      setIsSavingGoogleReview(false)
    }
  }

  const handleFeatureToggle = async (featureId: string, enabled: boolean) => {
    if (!tenant) return
    try {
      const response = await fetch(`/api/tenants/${tenant.id}/features`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          feature_flag_id: featureId,
          is_enabled: enabled
        })
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to toggle feature')
      }

      // Optimistically update UI
      setFeatures(prev => {
        const toggled = prev.find(f => f.id === featureId)
        if (!toggled) return prev

        return prev.map(f => {
          if (f.id === featureId) {
            return { ...f, isEnabled: enabled, isOverridden: true }
          }
          // Cascade disable children when parent toggled off
          if (!enabled && f.parentFlagName === toggled.name) {
            return { ...f, isDisabledByParent: true }
          }
          // Un-cascade children when parent toggled on
          if (enabled && f.parentFlagName === toggled.name) {
            return { ...f, isDisabledByParent: false }
          }
          return f
        })
      })

      toast.success('Feature updated successfully')
    } catch (error) {
      console.error('Error toggling feature:', error)
      toast.error(
        error instanceof Error ? error.message : 'Failed to toggle feature'
      )
      // Revert on error
      fetchTenantData()
    }
  }

  const isPersonal = Boolean(tenant.is_personal)
  const customBrandingEnabled =
    features.find(f => f.name === 'CUSTOM_BRANDING')?.isEnabled ?? true
  const brandingLocked = isPersonal || !customBrandingEnabled
  const googleReviewEnabled =
    features.find(f => f.name === 'GOOGLE_REVIEW')?.isEnabled ?? false
  const googleReviewLocked = isPersonal || !googleReviewEnabled

  // Whether each field is inherited from base
  const isFieldInherited = (field: BrandingField): boolean => {
    if (overrides === null) return false // legacy, no overrides info
    return !overrides.includes(field)
  }

  const hasAnyOverrides =
    overrides !== null && overrides.length > 0

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tenant Settings"
        description="Manage your tenant's branding and configuration"
      />

      <Tabs defaultValue="branding" className="space-y-6">
        <TabsList>
          <TabsTrigger value="branding">Branding</TabsTrigger>
          {googleReviewEnabled && (
            <TabsTrigger value="google-review">Google Review</TabsTrigger>
          )}
          <TabsTrigger value="features">Features</TabsTrigger>
          <TabsTrigger value="info">Info</TabsTrigger>
        </TabsList>

        <TabsContent value="branding" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Brand Customization</CardTitle>
              <CardDescription>
                Customize your tenant&apos;s logo and colors. Fields not
                customized will inherit from platform defaults.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {!customBrandingEnabled && (
                <div className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
                  Custom branding is disabled for this workspace. Contact a
                  super admin to enable it.
                </div>
              )}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  {isFieldInherited('logoUrl') && (
                    <Badge variant="secondary" className="text-[10px]">
                      Inherited
                    </Badge>
                  )}
                </div>
                <LogoUpload
                  value={logoUrl}
                  onChange={setLogoUrl}
                  tenantId={tenant?.id}
                  disabled={brandingLocked}
                />
              </div>

              <div className="grid gap-6 sm:grid-cols-2">
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Label>Primary Color</Label>
                    {isFieldInherited('primaryColor') && (
                      <Badge variant="secondary" className="text-[10px]">
                        Inherited
                      </Badge>
                    )}
                  </div>
                  <ColorPicker
                    label="Primary Color"
                    value={primaryColor}
                    onChange={setPrimaryColor}
                    id="primary-color"
                    disabled={brandingLocked}
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Label>Secondary Color</Label>
                    {isFieldInherited('secondaryColor') && (
                      <Badge variant="secondary" className="text-[10px]">
                        Inherited
                      </Badge>
                    )}
                  </div>
                  <ColorPicker
                    label="Secondary Color"
                    value={secondaryColor}
                    onChange={setSecondaryColor}
                    id="secondary-color"
                    disabled={brandingLocked}
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
                    This is your personal workspace. Branding changes are
                    disabled.
                  </p>
                )}
                <div className="flex items-center gap-2">
                  {hasAnyOverrides && !brandingLocked && (
                    <Button
                      variant="outline"
                      onClick={handleResetBranding}
                      disabled={isResetting || isSaving}
                    >
                      {isResetting ? (
                        <>
                          <Loader2 className="mr-2 size-4 animate-spin" />
                          Resetting...
                        </>
                      ) : (
                        <>
                          <RotateCcw className="mr-2 size-4" />
                          Reset to Defaults
                        </>
                      )}
                    </Button>
                  )}
                  <Button
                    onClick={handleSaveBranding}
                    disabled={isSaving || brandingLocked}
                  >
                    {isSaving ? (
                      <>
                        <Loader2 className="mr-2 size-4 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      'Save Changes'
                    )}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {googleReviewEnabled && (
          <TabsContent value="google-review" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Google Review Integration</CardTitle>
                <CardDescription>
                  Let customers share their feedback as a Google Review after
                  completing a conversation
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-2">
                  <Label htmlFor="google-place-id">Google Place ID</Label>
                  <Input
                    id="google-place-id"
                    placeholder="ChIJ..."
                    value={googlePlaceId}
                    onChange={e => setGooglePlaceId(e.target.value)}
                    disabled={googleReviewLocked}
                  />
                  <p className="text-xs text-muted-foreground">
                    Find your Place ID using the{' '}
                    <a
                      href="https://developers.google.com/maps/documentation/places/web-service/place-id"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-accent-orange underline underline-offset-2 hover:opacity-80"
                    >
                      Google Place ID Finder
                    </a>
                  </p>
                </div>

                <div className="flex items-center justify-between gap-4 pt-4">
                  {isPersonal && (
                    <p className="text-sm text-muted-foreground">
                      Google Review is not available for personal workspaces.
                    </p>
                  )}
                  <Button
                    onClick={handleSaveGoogleReview}
                    disabled={isSavingGoogleReview || googleReviewLocked}
                  >
                    {isSavingGoogleReview ? (
                      <>
                        <Loader2 className="mr-2 size-4 animate-spin" />
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
        )}

        <TabsContent value="features" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Feature Flags</CardTitle>
              <CardDescription>
                Enable or disable features for your workspace
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isPersonal && (
                <div className="mb-4 rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
                  Feature toggles are disabled for personal workspaces.
                </div>
              )}
              {features.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No features available
                </p>
              ) : (
                <div className="space-y-4">
                  {features.map(feature => (
                    <FeatureToggle
                      key={feature.id}
                      id={feature.id}
                      name={feature.name}
                      description={feature.description}
                      isEnabled={feature.isEnabled}
                      isOverridden={feature.isOverridden}
                      isChild={!!feature.parentFlagName}
                      isDisabledByParent={feature.isDisabledByParent}
                      parentFlagName={feature.parentFlagName}
                      onToggle={handleFeatureToggle}
                      disabled={isPersonal}
                    />
                  ))}
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
                  <Badge
                    variant={
                      tenant.status === 'active' ? 'default' : 'secondary'
                    }
                  >
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
