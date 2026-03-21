'use client'

import * as React from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ColorPicker, BrandingPreview } from '@/components/tenants'
import type { TenantBrandingDocument } from '@/lib/firestore-types'
import { validateHexColor, validateUrl } from '@/lib/validations'
import toast from 'react-hot-toast'

interface TenantBrandingTabProps {
 tenantId: string
 branding: TenantBrandingDocument | null
 onUpdate: () => void
}

export function TenantBrandingTab({
 tenantId,
 branding,
 onUpdate,
}: TenantBrandingTabProps) {
 const [isSaving, setIsSaving] = React.useState(false)
 const [formData, setFormData] = React.useState({
 logoUrl: branding?.logoUrl || '',
 primaryColor: branding?.primaryColor || '#000000',
 secondaryColor: branding?.secondaryColor || '#ffffff',
 })
 const [errors, setErrors] = React.useState({
 logoUrl: '',
 primaryColor: '',
 secondaryColor: '',
 })

 const validate = () => {
 const newErrors = { logoUrl: '', primaryColor: '', secondaryColor: '' }
 let isValid = true

 if (formData.logoUrl && !validateUrl(formData.logoUrl)) {
 newErrors.logoUrl = 'Invalid URL'
 isValid = false
 }

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
 <Label htmlFor="logoUrl">Logo URL</Label>
 <Input
 id="logoUrl"
 placeholder="https://example.com/logo.png"
 value={formData.logoUrl}
 onChange={(e) =>
 setFormData((prev) => ({ ...prev, logoUrl: e.target.value }))
 }
 disabled={isSaving}
 />
 {errors.logoUrl && (
 <p className="text-sm text-destructive">{errors.logoUrl}</p>
 )}
 {formData.logoUrl && !errors.logoUrl && (
 <div className="mt-2 rounded border p-4">
 <img
 src={formData.logoUrl}
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
 value={formData.primaryColor}
 onChange={(color) =>
 setFormData((prev) => ({ ...prev, primaryColor: color }))
 }
 id="primaryColor"
 />
 {errors.primaryColor && (
 <p className="text-sm text-destructive">{errors.primaryColor}</p>
 )}
 </div>

 {/* Secondary Color */}
 <div className="space-y-2">
 <ColorPicker
 label="Secondary Color"
 value={formData.secondaryColor}
 onChange={(color) =>
 setFormData((prev) => ({ ...prev, secondaryColor: color }))
 }
 id="secondaryColor"
 />
 {errors.secondaryColor && (
 <p className="text-sm text-destructive">{errors.secondaryColor}</p>
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
 logoUrl={formData.logoUrl}
 primaryColor={formData.primaryColor}
 secondaryColor={formData.secondaryColor}
 />
 </CardContent>
 </Card>
 </div>
 )
}
