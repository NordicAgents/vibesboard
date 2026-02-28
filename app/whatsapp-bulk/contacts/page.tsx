'use client'

import * as React from 'react'
import { Plus, Upload, Trash2, CheckCircle2, XCircle, Users as UsersIcon } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { DataTable, Column } from '@/components/ui/data-table'
import { EmptyState } from '@/components/ui/empty-state'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Switch } from '@/components/ui/switch'
import toast from 'react-hot-toast'

interface Contact {
  id: string
  tenant_id: string
  phone_number: string
  name: string | null
  email: string | null
  opted_in: boolean
  opted_in_at: string | null
  opted_out_at: string | null
  custom_fields: Record<string, any>
  tags: string[]
  created_at: string
  updated_at: string
}

interface ContactList {
  id: string
  tenant_id: string
  name: string
  description: string | null
  contact_count: number
  created_at: string
}

export default function ContactsPage() {
  const [contacts, setContacts] = React.useState<Contact[]>([])
  const [contactLists, setContactLists] = React.useState<ContactList[]>([])
  const [loading, setLoading] = React.useState(true)
  const [createDialogOpen, setCreateDialogOpen] = React.useState(false)
  const [importDialogOpen, setImportDialogOpen] = React.useState(false)
  const [createListDialogOpen, setCreateListDialogOpen] = React.useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false)
  const [selectedContact, setSelectedContact] = React.useState<Contact | null>(null)

  // Form states
  const [contactForm, setContactForm] = React.useState({
    phoneNumber: '',
    name: '',
    email: '',
    optedIn: true,
  })
  const [listForm, setListForm] = React.useState({
    name: '',
    description: '',
  })
  const [csvFile, setCsvFile] = React.useState<File | null>(null)
  const [submitting, setSubmitting] = React.useState(false)

  const fetchData = React.useCallback(async () => {
    try {
      setLoading(true)

      // Get active tenant ID
      const response = await fetch('/api/tenants/current')
      if (!response.ok) throw new Error('Failed to get tenant')
      const { tenantId } = await response.json()

      // Fetch contacts and lists in parallel
      const [contactsResponse, listsResponse] = await Promise.all([
        fetch(`/api/tenants/${tenantId}/whatsapp-bulk/contacts`),
        fetch(`/api/tenants/${tenantId}/whatsapp-bulk/contact-lists`),
      ])

      if (contactsResponse.ok) {
        const contactsData = await contactsResponse.json()
        setContacts(contactsData.contacts || [])
      }

      if (listsResponse.ok) {
        const listsData = await listsResponse.json()
        setContactLists(listsData.lists || [])
      }
    } catch (error) {
      console.error('Error fetching data:', error)
      toast.error('Failed to load data')
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    fetchData()
  }, [fetchData])

  const handleCreateContact = async (e: React.FormEvent) => {
    e.preventDefault()

    try {
      setSubmitting(true)

      const response = await fetch('/api/tenants/current')
      if (!response.ok) throw new Error('Failed to get tenant')
      const { tenantId } = await response.json()

      const createResponse = await fetch(`/api/tenants/${tenantId}/whatsapp-bulk/contacts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone_number: contactForm.phoneNumber,
          name: contactForm.name || undefined,
          email: contactForm.email || undefined,
          opted_in: contactForm.optedIn,
          opt_in_source: 'manual',
        }),
      })

      if (!createResponse.ok) {
        const error = await createResponse.json()
        throw new Error(error.error || 'Failed to create contact')
      }

      toast.success('Contact created successfully')
      setCreateDialogOpen(false)
      setContactForm({
        phoneNumber: '',
        name: '',
        email: '',
        optedIn: true,
      })
      fetchData()
    } catch (error: any) {
      console.error('Error creating contact:', error)
      toast.error(error.message || 'Failed to create contact')
    } finally {
      setSubmitting(false)
    }
  }

  const handleImportCSV = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!csvFile) {
      toast.error('Please select a CSV file')
      return
    }

    try {
      setSubmitting(true)

      const response = await fetch('/api/tenants/current')
      if (!response.ok) throw new Error('Failed to get tenant')
      const { tenantId } = await response.json()

      const csvContent = await csvFile.text()

      const importResponse = await fetch(`/api/tenants/${tenantId}/whatsapp-bulk/contacts/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          csv_content: csvContent,
          auto_opt_in: true,
        }),
      })

      if (!importResponse.ok) {
        const error = await importResponse.json()
        throw new Error(error.error || 'Failed to import contacts')
      }

      const result = await importResponse.json()
      toast.success(`Imported ${result.imported} contacts (${result.skipped} skipped)`)
      setImportDialogOpen(false)
      setCsvFile(null)
      fetchData()
    } catch (error: any) {
      console.error('Error importing contacts:', error)
      toast.error(error.message || 'Failed to import contacts')
    } finally {
      setSubmitting(false)
    }
  }

  const handleCreateList = async (e: React.FormEvent) => {
    e.preventDefault()

    try {
      setSubmitting(true)

      const response = await fetch('/api/tenants/current')
      if (!response.ok) throw new Error('Failed to get tenant')
      const { tenantId } = await response.json()

      const createResponse = await fetch(`/api/tenants/${tenantId}/whatsapp-bulk/contact-lists`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: listForm.name,
          description: listForm.description || undefined,
        }),
      })

      if (!createResponse.ok) {
        const error = await createResponse.json()
        throw new Error(error.error || 'Failed to create list')
      }

      toast.success('Contact list created successfully')
      setCreateListDialogOpen(false)
      setListForm({ name: '', description: '' })
      fetchData()
    } catch (error: any) {
      console.error('Error creating list:', error)
      toast.error(error.message || 'Failed to create list')
    } finally {
      setSubmitting(false)
    }
  }

  const handleToggleOptIn = async (contact: Contact) => {
    try {
      const response = await fetch(`/api/whatsapp-bulk/contacts/${contact.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          opted_in: !contact.opted_in,
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to update opt-in status')
      }

      toast.success(`Contact ${!contact.opted_in ? 'opted in' : 'opted out'}`)
      fetchData()
    } catch (error) {
      console.error('Error updating opt-in:', error)
      toast.error('Failed to update opt-in status')
    }
  }

  const handleDeleteContact = async () => {
    if (!selectedContact) return

    try {
      const response = await fetch(`/api/whatsapp-bulk/contacts/${selectedContact.id}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        throw new Error('Failed to delete contact')
      }

      toast.success('Contact deleted successfully')
      setDeleteDialogOpen(false)
      setSelectedContact(null)
      fetchData()
    } catch (error) {
      console.error('Error deleting contact:', error)
      toast.error('Failed to delete contact')
    }
  }

  const contactColumns: Column<Contact>[] = [
    {
      key: 'name',
      label: 'Contact',
      sortable: true,
      render: (contact) => (
        <div className="flex flex-col gap-1">
          <span className="font-medium">{contact.name || 'Unnamed'}</span>
          <span className="text-xs text-muted-foreground">{contact.phone_number}</span>
        </div>
      ),
    },
    {
      key: 'email',
      label: 'Email',
      render: (contact) => contact.email || '-',
    },
    {
      key: 'opted_in',
      label: 'Status',
      sortable: true,
      render: (contact) => {
        const Icon = contact.opted_in ? CheckCircle2 : XCircle
        return (
          <Badge variant={contact.opted_in ? 'default' : 'secondary'} className="gap-1">
            <Icon className="size-3" />
            {contact.opted_in ? 'Opted In' : 'Opted Out'}
          </Badge>
        )
      },
    },
    {
      key: 'tags',
      label: 'Tags',
      render: (contact) => contact.tags?.length || 0,
    },
    {
      key: 'created_at',
      label: 'Added',
      sortable: true,
      render: (contact) => new Date(contact.created_at).toLocaleDateString(),
    },
    {
      key: 'actions',
      label: 'Actions',
      render: (contact) => (
        <div className="flex gap-2">
          <Switch
            checked={contact.opted_in}
            onCheckedChange={() => handleToggleOptIn(contact)}
            aria-label="Toggle opt-in"
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation()
              setSelectedContact(contact)
              setDeleteDialogOpen(true)
            }}
          >
            <Trash2 className="size-4 text-destructive" />
          </Button>
        </div>
      ),
    },
  ]

  const listColumns: Column<ContactList>[] = [
    {
      key: 'name',
      label: 'List Name',
      sortable: true,
      render: (list) => (
        <div className="flex flex-col gap-1">
          <span className="font-medium">{list.name}</span>
          {list.description && (
            <span className="text-xs text-muted-foreground">{list.description}</span>
          )}
        </div>
      ),
    },
    {
      key: 'contact_count',
      label: 'Contacts',
      sortable: true,
      render: (list) => (
        <Badge variant="secondary">
          <UsersIcon className="mr-1 size-3" />
          {list.contact_count || 0}
        </Badge>
      ),
    },
    {
      key: 'created_at',
      label: 'Created',
      sortable: true,
      render: (list) => new Date(list.created_at).toLocaleDateString(),
    },
  ]

  return (
    <div className="h-full overflow-y-auto px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        title="Contacts & Lists"
        description="Manage your WhatsApp contacts and organize them into lists"
      />

      <Tabs defaultValue="contacts" className="w-full">
        <TabsList>
          <TabsTrigger value="contacts">Contacts</TabsTrigger>
          <TabsTrigger value="lists">Lists</TabsTrigger>
        </TabsList>

        <TabsContent value="contacts" className="space-y-4">
          <div className="flex gap-2">
            <Button onClick={() => setCreateDialogOpen(true)}>
              <Plus className="mr-2 size-4" />
              Add Contact
            </Button>
            <Button variant="outline" onClick={() => setImportDialogOpen(true)}>
              <Upload className="mr-2 size-4" />
              Import CSV
            </Button>
          </div>

          <DataTable
            data={contacts}
            columns={contactColumns}
            searchable
            searchPlaceholder="Search by name, phone, or email..."
            searchKeys={['name', 'phone_number', 'email']}
            pagination
            pageSize={20}
            loading={loading}
            emptyState={
              <EmptyState
                icon={Plus}
                title="No contacts"
                description="Add contacts individually or import from a CSV file"
                action={
                  <div className="flex gap-2">
                    <Button onClick={() => setCreateDialogOpen(true)}>
                      <Plus className="mr-2 size-4" />
                      Add Contact
                    </Button>
                    <Button variant="outline" onClick={() => setImportDialogOpen(true)}>
                      <Upload className="mr-2 size-4" />
                      Import CSV
                    </Button>
                  </div>
                }
              />
            }
          />
        </TabsContent>

        <TabsContent value="lists" className="space-y-4">
          <Button onClick={() => setCreateListDialogOpen(true)}>
            <Plus className="mr-2 size-4" />
            Create List
          </Button>

          <DataTable
            data={contactLists}
            columns={listColumns}
            searchable
            searchPlaceholder="Search lists..."
            searchKeys={['name', 'description']}
            pagination
            pageSize={20}
            loading={loading}
            emptyState={
              <EmptyState
                icon={UsersIcon}
                title="No contact lists"
                description="Create lists to organize your contacts for targeted campaigns"
                action={
                  <Button onClick={() => setCreateListDialogOpen(true)}>
                    <Plus className="mr-2 size-4" />
                    Create List
                  </Button>
                }
              />
            }
          />
        </TabsContent>
      </Tabs>

      {/* Create Contact Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <form onSubmit={handleCreateContact}>
            <DialogHeader>
              <DialogTitle>Add Contact</DialogTitle>
              <DialogDescription>
                Add a new contact to your WhatsApp contact list
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="phoneNumber">Phone Number * (with country code)</Label>
                <Input
                  id="phoneNumber"
                  value={contactForm.phoneNumber}
                  onChange={(e) => setContactForm({ ...contactForm, phoneNumber: e.target.value })}
                  placeholder="+1234567890"
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  value={contactForm.name}
                  onChange={(e) => setContactForm({ ...contactForm, name: e.target.value })}
                  placeholder="John Doe"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={contactForm.email}
                  onChange={(e) => setContactForm({ ...contactForm, email: e.target.value })}
                  placeholder="john@example.com"
                />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="optedIn">Opted In</Label>
                <Switch
                  id="optedIn"
                  checked={contactForm.optedIn}
                  onCheckedChange={(checked) => setContactForm({ ...contactForm, optedIn: checked })}
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setCreateDialogOpen(false)}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? 'Adding...' : 'Add Contact'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Import CSV Dialog */}
      <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <form onSubmit={handleImportCSV}>
            <DialogHeader>
              <DialogTitle>Import Contacts from CSV</DialogTitle>
              <DialogDescription>
                Upload a CSV file with columns: phone_number (required), name, email, tags
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="csvFile">CSV File</Label>
                <Input
                  id="csvFile"
                  type="file"
                  accept=".csv"
                  onChange={(e) => setCsvFile(e.target.files?.[0] || null)}
                  required
                />
                <p className="text-xs text-muted-foreground">
                  All imported contacts will be automatically opted in
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setImportDialogOpen(false)}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={submitting || !csvFile}>
                {submitting ? 'Importing...' : 'Import'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Create List Dialog */}
      <Dialog open={createListDialogOpen} onOpenChange={setCreateListDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <form onSubmit={handleCreateList}>
            <DialogHeader>
              <DialogTitle>Create Contact List</DialogTitle>
              <DialogDescription>
                Create a new list to organize your contacts
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="listName">List Name *</Label>
                <Input
                  id="listName"
                  value={listForm.name}
                  onChange={(e) => setListForm({ ...listForm, name: e.target.value })}
                  placeholder="VIP Customers"
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="listDescription">Description</Label>
                <Input
                  id="listDescription"
                  value={listForm.description}
                  onChange={(e) => setListForm({ ...listForm, description: e.target.value })}
                  placeholder="High-value customers"
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setCreateListDialogOpen(false)}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? 'Creating...' : 'Create List'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Contact?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete {selectedContact?.name || 'this contact'}?
              This action cannot be undone and will remove them from all lists.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteContact} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
