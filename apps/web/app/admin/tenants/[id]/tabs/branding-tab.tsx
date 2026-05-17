'use client'

import * as React from 'react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { ColorPicker, BrandingPreview, LogoUpload } from '@/components/tenants'
import type {
  TenantBrandingDocument,
  BrandingField
} from '@vibesboard/contracts'
import { validateHexColor } from '@/lib/validations'
import toast from 'react-hot-toast'
import { Loader2, RotateCcw } from 'lucide-react'

interface BaseBranding {
  logoUrl?: string
  primaryColor: string
  secondaryColor: string
}

interface TenantBrandingTabProps {
  tenantId: string
  branding: TenantBrandingDocument | null
  onUpdate: () => void
}

export function TenantBrandingTab({
  tenantId,
  branding,
  onUpdate
}: TenantBrandingTabProps) {
  const [isSaving, setIsSaving] = React.useState(false)
  const [isResetting, setIsResetting] = React.useState(false)
  const [baseBranding, setBaseBranding] = React.useState<BaseBranding | null>(
    null
  )
  const [overrides, setOverrides] = React.useState<BrandingField[] | null>(null)
  const [formData, setFormData] = React.useState({
    logoUrl: branding?.logoUrl || '',
    primaryColor: branding?.primaryColor || '#000000',
    secondaryColor: branding?.secondaryColor || '#ffffff'
  })
  const [errors, setErrors] = React.useState({
    logoUrl: '',
    primaryColor: '',
    secondaryColor: ''
  })

  // Fetch branding with base branding info on mount
  React.useEffect(() => {
    fetchBrandingDetails()
  }, [tenantId])

  const fetchBrandingDetails = async () => {
    try {
      const response = await fetch(`/api/tenants/${tenantId}/branding`)
      if (response.ok) {
        const data = await response.json()
        if (data.baseBranding) setBaseBranding(data.baseBranding)
        if (data.overrides !== undefined) setOverrides(data.overrides)
        if (data.branding) {
          setFormData({
            logoUrl: data.branding.logoUrl || '',
            primaryColor: data.branding.primaryColor || '#000000',
            secondaryColor: data.branding.secondaryColor || '#ffffff'
          })
        }
      }
    } catch (error) {
      console.error('Error fetching branding details:', error)
    }
  }

  const validate = () => {
    const newErrors = { logoUrl: '', primaryColor: '', secondaryColor: '' }
    let isValid = true

    if (!validateHexColor(formData.primaryColor)) {
      newErrors.primaryColor = 'Invalid hex color'
      isValid = false
    }

    if (!validateHexColor(formData.secondaryColor)) {
      newErrors.secondaryColor = 'Invalid hex color'
      isValid = false
    }

    setErrors(newErrors)
    return isValid
  }

  const handleSave = async () => {
    if (!validate()) {
      return
    }

    try {
      setIsSaving(true)

      const response = await fetch(`/api/tenants/${tenantId}/branding`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      })

      if (!response.ok) {
        throw new Error('Failed to update branding')
      }

      const data = await response.json()
      if (data.overrides !== undefined) setOverrides(data.overrides)
      if (data.baseBranding) setBaseBranding(data.baseBranding)

      toast.success('Branding updated successfully')
      onUpdate()
    } catch (error) {
      console.error('Error updating branding:', error)
      toast.error('Failed to update branding')
    } finally {
      setIsSaving(false)
    }
  }

  const handleReset = async () => {
    try {
      setIsResetting(true)

      const response = await fetch(`/api/tenants/${tenantId}/branding/reset`, {
        method: 'POST'
      })

      if (!response.ok) {
        throw new Error('Failed to reset branding')
      }

      const data = await response.json()
      if (data.branding) {
        setFormData({
          logoUrl: data.branding.logoUrl || '',
          primaryColor: data.branding.primaryColor || '#000000',
          secondaryColor: data.branding.secondaryColor || '#ffffff'
        })
      }
      if (data.baseBranding) setBaseBranding(data.baseBranding)
      setOverrides(data.overrides ?? [])

      toast.success('Branding reset to platform defaults')
      onUpdate()
    } catch (error) {
      console.error('Error resetting branding:', error)
      toast.error('Failed to reset branding')
    } finally {
      setIsResetting(false)
    }
  }

  const isFieldInherited = (field: BrandingField): boolean => {
    if (overrides === null) return false
    return !overrides.includes(field)
  }

  const hasAnyOverrides = overrides !== null && overrides.length > 0

  return (
    <div className="grid gap-6 md:grid-cols-2">
      {/* Branding Form */}
      <Card>
        <CardHeader>
          <CardTitle>Branding Settings</CardTitle>
          <CardDescription>
            Customize the look and feel for this tenant. Fields marked
            &quot;Inherited&quot; use platform defaults.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Logo */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              {isFieldInherited('logoUrl') && (
                <Badge variant="secondary" className="text-[10px]">
                  Inherited
                </Badge>
              )}
            </div>
            <LogoUpload
              value={formData.logoUrl}
              onChange={url => setFormData(prev => ({ ...prev, logoUrl: url }))}
              tenantId={tenantId}
              disabled={isSaving}
            />
          </div>

          {/* Primary Color */}
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
              value={formData.primaryColor}
              onChange={color =>
                setFormData(prev => ({ ...prev, primaryColor: color }))
              }
              id="primaryColor"
            />
            {errors.primaryColor && (
              <p className="text-sm text-destructive">{errors.primaryColor}</p>
            )}
          </div>

          {/* Secondary Color */}
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
              value={formData.secondaryColor}
              onChange={color =>
                setFormData(prev => ({ ...prev, secondaryColor: color }))
              }
              id="secondaryColor"
            />
            {errors.secondaryColor && (
              <p className="text-sm text-destructive">
                {errors.secondaryColor}
              </p>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 pt-4">
            {hasAnyOverrides && (
              <Button
                variant="outline"
                onClick={handleReset}
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
              onClick={handleSave}
              disabled={isSaving}
              className={hasAnyOverrides ? '' : 'w-full'}
            >
              {isSaving ? 'Saving...' : 'Save Branding'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Live Preview */}
      <Card>
        <CardHeader>
          <CardTitle>Live Preview</CardTitle>
          <CardDescription>
            See how the branding will look in the application
          </CardDescription>
        </CardHeader>
        <CardContent>
          <BrandingPreview
            tenantName="Preview"
            logoUrl={formData.logoUrl}
            primaryColor={formData.primaryColor}
            secondaryColor={formData.secondaryColor}
          />
        </CardContent>
      </Card>
    </div>
  )
}
