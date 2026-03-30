'use client'

import { useCallback } from 'react'
import { GripVertical, Plus, Trash2 } from 'lucide-react'

import type { CollectionField, CollectionFieldType } from '@/lib/types'
import { nanoid } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle
} from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'

const FIELD_TYPES: { value: CollectionFieldType; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Phone' },
  { value: 'number', label: 'Number' },
  { value: 'long_text', label: 'Long Text' },
  { value: 'choice', label: 'Choice' }
]

interface CollectionFieldsEditorProps {
  fields: CollectionField[]
  onChange: (fields: CollectionField[]) => void
  disabled?: boolean
}

export function CollectionFieldsEditor({
  fields,
  onChange,
  disabled
}: CollectionFieldsEditorProps) {
  const addField = useCallback(() => {
    const newField: CollectionField = {
      id: nanoid(),
      label: '',
      type: 'text',
      required: true,
      order: fields.length
    }
    onChange([...fields, newField])
  }, [fields, onChange])

  const updateField = useCallback(
    (id: string, updates: Partial<CollectionField>) => {
      onChange(
        fields.map(f => (f.id === id ? { ...f, ...updates } : f))
      )
    },
    [fields, onChange]
  )

  const removeField = useCallback(
    (id: string) => {
      onChange(
        fields
          .filter(f => f.id !== id)
          .map((f, i) => ({ ...f, order: i }))
      )
    },
    [fields, onChange]
  )

  const moveField = useCallback(
    (index: number, direction: -1 | 1) => {
      const sortedFields = [...fields].sort((a, b) => a.order - b.order)
      const newIndex = index + direction
      if (newIndex < 0 || newIndex >= sortedFields.length) return
      const updated = [...sortedFields]
      const [moved] = updated.splice(index, 1)
      updated.splice(newIndex, 0, moved)
      onChange(updated.map((f, i) => ({ ...f, order: i })))
    },
    [fields, onChange]
  )

  const sorted = [...fields].sort((a, b) => a.order - b.order)

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Collection Fields</CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={addField}
            disabled={disabled || fields.length >= 20}
          >
            <Plus className="mr-1 size-3.5" />
            Add Field
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Define the information your agent should collect. The AI will ask questions in order and won&apos;t complete until all required fields are answered.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {sorted.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            No fields defined. The agent will use its instructions to decide what to collect.
          </p>
        ) : (
          sorted.map((field, index) => (
            <div
              key={field.id}
              className="flex gap-2 rounded-lg border p-3"
            >
              {/* Drag handle / reorder */}
              <div className="flex flex-col items-center justify-center gap-0.5">
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                  disabled={disabled || index === 0}
                  onClick={() => moveField(index, -1)}
                  aria-label="Move up"
                >
                  <GripVertical className="size-4" />
                </button>
              </div>

              {/* Field config */}
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex gap-2">
                  <Input
                    value={field.label}
                    onChange={e =>
                      updateField(field.id, { label: e.target.value })
                    }
                    placeholder="Field label (e.g. Full Name)"
                    className="flex-1"
                    disabled={disabled}
                  />
                  <Select
                    value={field.type}
                    onValueChange={(val: CollectionFieldType) =>
                      updateField(field.id, {
                        type: val,
                        choices: val === 'choice' ? field.choices ?? [''] : undefined
                      })
                    }
                    disabled={disabled}
                  >
                    <SelectTrigger className="w-[120px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FIELD_TYPES.map(t => (
                        <SelectItem key={t.value} value={t.value}>
                          {t.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <Input
                  value={field.description ?? ''}
                  onChange={e =>
                    updateField(field.id, {
                      description: e.target.value || undefined
                    })
                  }
                  placeholder="Hint for the AI (e.g. Ask for their work email)"
                  className="text-xs"
                  disabled={disabled}
                />

                {field.type === 'choice' && (
                  <Input
                    value={(field.choices ?? []).join(', ')}
                    onChange={e =>
                      updateField(field.id, {
                        choices: e.target.value
                          .split(',')
                          .map(s => s.trim())
                          .filter(Boolean)
                      })
                    }
                    placeholder="Comma-separated choices (e.g. Option A, Option B)"
                    className="text-xs"
                    disabled={disabled}
                  />
                )}

                <div className="flex items-center gap-2">
                  <Switch
                    checked={field.required}
                    onCheckedChange={val =>
                      updateField(field.id, { required: val })
                    }
                    disabled={disabled}
                  />
                  <span className="text-xs text-muted-foreground">
                    Required
                  </span>
                </div>
              </div>

              {/* Delete */}
              <button
                type="button"
                className="self-start text-muted-foreground hover:text-destructive disabled:opacity-30"
                disabled={disabled}
                onClick={() => removeField(field.id)}
                aria-label="Remove field"
              >
                <Trash2 className="size-4" />
              </button>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  )
}
