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
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import type { TenantDocument } from '@/lib/firestore-types'
import { Copy } from 'lucide-react'
import toast from 'react-hot-toast'

interface TenantOverviewTabProps {
 tenant: TenantDocument
 onUpdate: () => void
}

export function TenantOverviewTab({
 tenant,
 onUpdate
}: TenantOverviewTabProps) {
 const [isEditing, setIsEditing] = React.useState(false)
 const [isSaving, setIsSaving] = React.useState(false)
 const [formData, setFormData] = React.useState({
 name: tenant.name,
 slug: tenant.slug,
 status: tenant.status
 })

 const handleCopy = (text: string) => {
 navigator.clipboard.writeText(text)
 toast.success('Copied to clipboard')
 }

 const handleSave = async () => {
 try {
 setIsSaving(true)

 const response = await fetch(`/api/admin/tenants/${tenant.id}`, {
 method: 'PUT',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify(formData)
 })

 if (!response.ok) {
 throw new Error('Failed to update tenant')
 }

 toast.success('Tenant updated successfully')
 setIsEditing(false)
 onUpdate()
 } catch (error) {
 console.error('Error updating tenant:', error)
 toast.error('Failed to update tenant')
 } finally {
 setIsSaving(false)
 }
 }

 const handleCancel = () => {
 setFormData({
 name: tenant.name,
 slug: tenant.slug,
 status: tenant.status
 })
 setIsEditing(false)
 }

 const statusColors: Record<string, 'default' | 'secondary' | 'destructive'> =
 {
 active: 'default',
 trial: 'secondary',
 suspended: 'destructive'
 }

 return (
 <Card>
 <CardHeader>
 <div className="flex items-center justify-between">
 <div>
 <CardTitle>Tenant Information</CardTitle>
 <CardDescription>Basic details about this tenant</CardDescription>
 </div>
 {!isEditing && (
 <Button onClick={() => setIsEditing(true)}>Edit</Button>
 )}
 </div>
 </CardHeader>
 <CardContent className="space-y-4">
 {/* Tenant ID */}
 <div className="space-y-2">
 <Label>Tenant ID</Label>
 <div className="flex items-center gap-2">
 <Input value={tenant.id} readOnly className="font-mono text-sm" />
 <Button
 variant="outline"
 size="sm"
 onClick={() => handleCopy(tenant.id)}
 >
 <Copy className="size-4" />
 </Button>
 </div>
 </div>

 {/* Name */}
 <div className="space-y-2">
 <Label htmlFor="name">Name</Label>
 {isEditing ? (
 <Input
 id="name"
 value={formData.name}
 onChange={e =>
 setFormData(prev => ({ ...prev, name: e.target.value }))
 }
 disabled={isSaving}
 />
 ) : (
 <div className="text-sm">{tenant.name}</div>
 )}
 </div>

 {/* Slug */}
 <div className="space-y-2">
 <Label htmlFor="slug">Slug</Label>
 {isEditing ? (
 <Input
 id="slug"
 value={formData.slug}
 onChange={e =>
 setFormData(prev => ({ ...prev, slug: e.target.value }))
 }
 disabled={isSaving}
 className="font-mono"
 />
 ) : (
 <div className="font-mono text-sm">/{tenant.slug}</div>
 )}
 </div>

 {/* Status */}
 <div className="space-y-2">
 <Label htmlFor="status">Status</Label>
 {isEditing ? (
 <select
 id="status"
 value={formData.status}
 onChange={e =>
 setFormData(prev => ({
 ...prev,
 status: e.target.value as 'active' | 'trial' | 'suspended'
 }))
 }
 disabled={isSaving}
 className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background"
 >
 <option value="active">Active</option>
 <option value="trial">Trial</option>
 <option value="suspended">Suspended</option>
 </select>
 ) : (
 <div className="flex items-center">
 <Badge
 variant={statusColors[tenant.status]}
 className="capitalize"
 >
 {tenant.status}
 </Badge>
 </div>
 )}
 </div>

 {/* Created Date */}
 <div className="space-y-2">
 <Label>Created</Label>
 <div className="text-sm text-muted-foreground">
 {new Date(tenant.createdAt).toLocaleString()}
 </div>
 </div>

 {/* Updated Date */}
 <div className="space-y-2">
 <Label>Last Updated</Label>
 <div className="text-sm text-muted-foreground">
 {new Date(tenant.updatedAt).toLocaleString()}
 </div>
 </div>

 {/* Action buttons */}
 {isEditing && (
 <div className="flex justify-end gap-2 pt-4">
 <Button
 variant="outline"
 onClick={handleCancel}
 disabled={isSaving}
 >
 Cancel
 </Button>
 <Button onClick={handleSave} disabled={isSaving}>
 {isSaving ? 'Saving...' : 'Save Changes'}
 </Button>
 </div>
 )}
 </CardContent>
 </Card>
 )
}
