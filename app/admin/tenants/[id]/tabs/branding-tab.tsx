'use client'

import * as React from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ColorPicker, BrandingPreview } from '@/components/tenants'
import { Database } from '@/lib/db_types'
import { validateHexColor, validateUrl } from '@/lib/validations'
import toast from 'react-hot-toast'

type TenantBranding = Database['public']['Tables']['tenant_branding']['Row']

interface TenantBrandingTabProps {
    tenantId: string
    branding: TenantBranding | null
    onUpdate: () => void
}

export function TenantBrandingTab({
    tenantId,
    branding,
    onUpdate,
}: TenantBrandingTabProps) {
    const [isSaving, setIsSaving] = React.useState(false)
    const [formData, setFormData] = React.useState({
        logo_url: branding?.logo_url || '',
        primary_color: branding?.primary_color || '#000000',
        secondary_color: branding?.secondary_color || '#ffffff',
    })
    const [errors, setErrors] = React.useState({
        logo_url: '',
        primary_color: '',
        secondary_color: '',
    })

    const validate = () => {
        const newErrors = { logo_url: '', primary_color: '', secondary_color: '' }
        let isValid = true

        if (formData.logo_url && !validateUrl(formData.logo_url)) {
            newErrors.logo_url = 'Invalid URL'
            isValid = false
        }

        if (!validateHexColor(formData.primary_color)) {
            newErrors.primary_color = 'Invalid hex color'
            isValid = false
        }

        if (!validateHexColor(formData.secondary_color)) {
            newErrors.secondary_color = 'Invalid hex color'
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
                body: JSON.stringify(formData),
            })

            if (!response.ok) {
                throw new Error('Failed to update branding')
            }

            toast.success('Branding updated successfully')
            onUpdate()
        } catch (error) {
            console.error('Error updating branding:', error)
            toast.error('Failed to update branding')
        } finally {
            setIsSaving(false)
        }
    }

    return (
        <div className="grid gap-6 md:grid-cols-2">
            {/* Branding Form */}
            <Card>
                <CardHeader>
                    <CardTitle>Branding Settings</CardTitle>
                    <CardDescription>
                        Customize the look and feel for this tenant
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    {/* Logo URL */}
                    <div className="space-y-2">
                        <Label htmlFor="logo_url">Logo URL</Label>
                        <Input
                            id="logo_url"
                            placeholder="https://example.com/logo.png"
                            value={formData.logo_url}
                            onChange={(e) =>
                                setFormData((prev) => ({ ...prev, logo_url: e.target.value }))
                            }
                            disabled={isSaving}
                        />
                        {errors.logo_url && (
                            <p className="text-sm text-destructive">{errors.logo_url}</p>
                        )}
                        {formData.logo_url && !errors.logo_url && (
                            <div className="mt-2 rounded border p-4">
                                <img
                                    src={formData.logo_url}
                                    alt="Logo preview"
                                    className="h-12 object-contain"
                                    onError={(e) => {
                                        e.currentTarget.style.display = 'none'
                                    }}
                                />
                            </div>
                        )}
                    </div>

                    {/* Primary Color */}
                    <div className="space-y-2">
                        <ColorPicker
                            label="Primary Color"
                            value={formData.primary_color}
                            onChange={(color) =>
                                setFormData((prev) => ({ ...prev, primary_color: color }))
                            }
                            id="primary_color"
                        />
                        {errors.primary_color && (
                            <p className="text-sm text-destructive">{errors.primary_color}</p>
                        )}
                    </div>

                    {/* Secondary Color */}
                    <div className="space-y-2">
                        <ColorPicker
                            label="Secondary Color"
                            value={formData.secondary_color}
                            onChange={(color) =>
                                setFormData((prev) => ({ ...prev, secondary_color: color }))
                            }
                            id="secondary_color"
                        />
                        {errors.secondary_color && (
                            <p className="text-sm text-destructive">{errors.secondary_color}</p>
                        )}
                    </div>

                    {/* Save button */}
                    <div className="pt-4">
                        <Button onClick={handleSave} disabled={isSaving} className="w-full">
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
                        logoUrl={formData.logo_url}
                        primaryColor={formData.primary_color}
                        secondaryColor={formData.secondary_color}
                    />
                </CardContent>
            </Card>
        </div>
    )
}
