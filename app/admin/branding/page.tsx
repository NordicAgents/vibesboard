'use client'

import { useState, useEffect } from 'react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { ColorPicker } from '@/components/tenants/color-picker'
import { BrandingPreview } from '@/components/tenants/branding-preview'
import { LogoUpload } from '@/components/tenants/logo-upload'
import toast from 'react-hot-toast'
import { Loader2 } from 'lucide-react'

export default function PlatformBrandingPage() {
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [logoUrl, setLogoUrl] = useState('')
  const [primaryColor, setPrimaryColor] = useState('#000000')
  const [secondaryColor, setSecondaryColor] = useState('#ffffff')

  useEffect(() => {
    fetchBranding()
  }, [])

  const fetchBranding = async () => {
    try {
      setIsLoading(true)
      const response = await fetch('/api/admin/platform-branding')
      if (response.ok) {
        const data = await response.json()
        if (data.branding) {
          setLogoUrl(data.branding.logoUrl || '')
          setPrimaryColor(data.branding.primaryColor || '#000000')
          setSecondaryColor(data.branding.secondaryColor || '#ffffff')
        }
      }
    } catch (error) {
      console.error('Error fetching platform branding:', error)
      toast.error('Failed to load platform branding')
    } finally {
      setIsLoading(false)
    }
  }

  const handleSave = async () => {
    setIsSaving(true)
    try {
      const response = await fetch('/api/admin/platform-branding', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          logoUrl: logoUrl || null,
          primaryColor,
          secondaryColor
        })
      })

      if (response.ok) {
        toast.success('Platform branding updated')
      } else {
        const data = await response.json()
        toast.error(data.error || 'Failed to update platform branding')
      }
    } catch (error) {
      console.error('Error saving platform branding:', error)
      toast.error('Failed to update platform branding')
    } finally {
      setIsSaving(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <div className="animate-fade-slide-in">
        <p className="label-caps mb-1">Platform</p>
        <h1 className="font-sans text-2xl font-normal text-[#222f30] dark:text-[#f5f8f7] sm:text-3xl">
          Base Branding
        </h1>
        <p className="mt-1.5 text-sm text-[#445e5f] dark:text-[#6f7f80]">
          Default branding for all new tenants. Tenants that haven&apos;t
          customized their branding will inherit these values.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Platform Defaults</CardTitle>
            <CardDescription>
              These colors and logo apply to all tenants that haven&apos;t set
              their own branding.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <LogoUpload
                value={logoUrl}
                onChange={setLogoUrl}
                disabled={isSaving}
              />
            </div>

            <div className="space-y-2">
              <ColorPicker
                label="Primary Color"
                value={primaryColor}
                onChange={setPrimaryColor}
                id="primary-color"
                disabled={isSaving}
              />
            </div>

            <div className="space-y-2">
              <ColorPicker
                label="Secondary Color"
                value={secondaryColor}
                onChange={setSecondaryColor}
                id="secondary-color"
                disabled={isSaving}
              />
            </div>

            <div className="pt-4">
              <Button
                onClick={handleSave}
                disabled={isSaving}
                className="w-full"
              >
                {isSaving ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  'Save Platform Branding'
                )}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Live Preview</CardTitle>
            <CardDescription>
              How the default branding will look for tenants
            </CardDescription>
          </CardHeader>
          <CardContent>
            <BrandingPreview
              tenantName="Default"
              logoUrl={logoUrl}
              primaryColor={primaryColor}
              secondaryColor={secondaryColor}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
