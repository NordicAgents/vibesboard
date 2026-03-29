'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'react-hot-toast'
import type {
  VibeAgent,
  AgentMode,
  CollectionField,
  QuickSuggestionsMode
} from '@/lib/types'
import type { AgentNotificationConfig } from '@/lib/firestore-types'

export interface AgentFormFields {
  name: string
  instructions: string
  greetingText: string
  allowAnonymous: boolean
  mode: AgentMode
  maxResponses: number | null
  maxAgentResponses: number | null
  quickSuggestionsMode: QuickSuggestionsMode
  quickSuggestionsCount: number
  googleReviewEnabled: boolean
  googlePlaceId: string
  sourceUrls: string[]
  notificationConfig: AgentNotificationConfig | undefined
  handoffTargets: string[]
  collectionFields: CollectionField[]
}

export interface AgentFormSetters {
  setName: (v: string) => void
  setInstructions: (v: string) => void
  setGreetingText: (v: string) => void
  setAllowAnonymous: (v: boolean) => void
  setMode: (v: AgentMode) => void
  setMaxResponses: (v: number | null) => void
  setMaxAgentResponses: (v: number | null) => void
  setQuickSuggestionsMode: (v: QuickSuggestionsMode) => void
  setQuickSuggestionsCount: (v: number) => void
  setGoogleReviewEnabled: (v: boolean) => void
  setGooglePlaceId: (v: string) => void
  setSourceUrls: (v: string[]) => void
  setNotificationConfig: (v: AgentNotificationConfig | undefined) => void
  setHandoffTargets: (v: string[]) => void
  setCollectionFields: (v: CollectionField[]) => void
}

export interface UseAgentFormReturn {
  fields: AgentFormFields
  setters: AgentFormSetters
  hasChanges: boolean
  saving: boolean
  isDeleting: boolean
  handleSaveAll: () => Promise<void>
  handleDelete: () => Promise<void>
  applyTemplate: (partial: Partial<AgentFormFields>) => void
}

export function useAgentForm(agent: VibeAgent): UseAgentFormReturn {
  const router = useRouter()

  // ── Form state ──
  const [name, setName] = useState(agent.name)
  const [instructions, setInstructions] = useState(agent.instructions)
  const [greetingText, setGreetingText] = useState(
    agent.greetingText ?? 'Hi How can i help you today'
  )
  const [allowAnonymous, setAllowAnonymous] = useState(agent.allowAnonymous)
  const [mode, setMode] = useState<AgentMode>(agent.mode || 'provider')
  const [maxResponses, setMaxResponses] = useState<number | null>(
    agent.maxResponses ?? null
  )
  const [maxAgentResponses, setMaxAgentResponses] = useState<number | null>(
    agent.maxAgentResponses ?? null
  )
  const [quickSuggestionsMode, setQuickSuggestionsMode] =
    useState<QuickSuggestionsMode>(agent.quickSuggestionsMode ?? 'off')
  const [quickSuggestionsCount, setQuickSuggestionsCount] = useState<number>(
    agent.quickSuggestionsCount ?? 4
  )
  const [googleReviewEnabled, setGoogleReviewEnabled] = useState(
    agent.googleReviewEnabled ?? false
  )
  const [googlePlaceId, setGooglePlaceId] = useState(
    agent.googlePlaceId ?? ''
  )
  const [sourceUrls, setSourceUrls] = useState<string[]>(
    agent.sourceUrls ?? []
  )
  const [notificationConfig, setNotificationConfig] = useState<
    AgentNotificationConfig | undefined
  >(agent.notificationConfig as AgentNotificationConfig | undefined)
  const [handoffTargets, setHandoffTargets] = useState<string[]>(
    agent.handoffTargets ?? []
  )
  const [collectionFields, setCollectionFields] = useState<CollectionField[]>(
    agent.collectionFields ?? []
  )
  const [saving, setSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  // ── Change detection ──
  const hasChanges =
    name !== agent.name ||
    instructions !== agent.instructions ||
    greetingText.trim() !==
      (agent.greetingText?.trim() ?? 'Hi How can i help you today') ||
    allowAnonymous !== agent.allowAnonymous ||
    mode !== (agent.mode || 'provider') ||
    maxResponses !== (agent.maxResponses ?? null) ||
    maxAgentResponses !== (agent.maxAgentResponses ?? null) ||
    quickSuggestionsMode !== (agent.quickSuggestionsMode ?? 'off') ||
    quickSuggestionsCount !== (agent.quickSuggestionsCount ?? 4) ||
    googleReviewEnabled !== (agent.googleReviewEnabled ?? false) ||
    (googlePlaceId.trim() || null) !== (agent.googlePlaceId ?? null) ||
    JSON.stringify(sourceUrls) !== JSON.stringify(agent.sourceUrls ?? []) ||
    JSON.stringify(notificationConfig) !==
      JSON.stringify(agent.notificationConfig ?? undefined) ||
    JSON.stringify(handoffTargets) !==
      JSON.stringify(agent.handoffTargets ?? []) ||
    JSON.stringify(collectionFields) !==
      JSON.stringify(agent.collectionFields ?? [])

  // ── Save all ──
  const handleSaveAll = async () => {
    setSaving(true)
    const payload: Partial<VibeAgent> = {
      name,
      instructions,
      greetingText: greetingText.trim() || null,
      allowAnonymous,
      mode,
      maxResponses,
      maxAgentResponses,
      quickSuggestionsMode,
      quickSuggestionsCount,
      googleReviewEnabled,
      googlePlaceId: googlePlaceId.trim() || null,
      sourceUrls,
      notificationConfig,
      handoffTargets,
      collectionFields: mode === 'collector' ? collectionFields : []
    }

    try {
      const res = await fetch(`/api/agents/${agent.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      if (!res.ok) {
        const error = await res.json().catch(() => ({}))
        throw new Error(error.error ?? 'Failed to update')
      }
      toast.success('Changes saved')
      router.refresh()
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to save changes'
      )
    } finally {
      setSaving(false)
    }
  }

  // ── Delete ──
  const handleDelete = async () => {
    setIsDeleting(true)
    try {
      const res = await fetch(`/api/agents/${agent.id}`, {
        method: 'DELETE'
      })
      if (!res.ok) throw new Error('Failed to delete agent')
      toast.success('Agent deleted')
      router.push('/')
      router.refresh()
    } catch {
      toast.error('Failed to delete agent')
      setIsDeleting(false)
    }
  }

  // ── Apply template (bulk set) ──
  const applyTemplate = (partial: Partial<AgentFormFields>) => {
    if (partial.name !== undefined) setName(partial.name)
    if (partial.instructions !== undefined) setInstructions(partial.instructions)
    if (partial.greetingText !== undefined) setGreetingText(partial.greetingText)
    if (partial.allowAnonymous !== undefined) setAllowAnonymous(partial.allowAnonymous)
    if (partial.mode !== undefined) setMode(partial.mode)
    if (partial.maxResponses !== undefined) setMaxResponses(partial.maxResponses)
    if (partial.maxAgentResponses !== undefined) setMaxAgentResponses(partial.maxAgentResponses)
    if (partial.quickSuggestionsMode !== undefined) setQuickSuggestionsMode(partial.quickSuggestionsMode)
    if (partial.quickSuggestionsCount !== undefined) setQuickSuggestionsCount(partial.quickSuggestionsCount)
    if (partial.googleReviewEnabled !== undefined) setGoogleReviewEnabled(partial.googleReviewEnabled)
    if (partial.googlePlaceId !== undefined) setGooglePlaceId(partial.googlePlaceId)
    if (partial.sourceUrls !== undefined) setSourceUrls(partial.sourceUrls)
    if (partial.notificationConfig !== undefined) setNotificationConfig(partial.notificationConfig)
    if (partial.handoffTargets !== undefined) setHandoffTargets(partial.handoffTargets)
    if (partial.collectionFields !== undefined) setCollectionFields(partial.collectionFields)
  }

  return {
    fields: {
      name,
      instructions,
      greetingText,
      allowAnonymous,
      mode,
      maxResponses,
      maxAgentResponses,
      quickSuggestionsMode,
      quickSuggestionsCount,
      googleReviewEnabled,
      googlePlaceId,
      sourceUrls,
      notificationConfig,
      handoffTargets,
      collectionFields
    },
    setters: {
      setName,
      setInstructions,
      setGreetingText,
      setAllowAnonymous,
      setMode,
      setMaxResponses,
      setMaxAgentResponses,
      setQuickSuggestionsMode,
      setQuickSuggestionsCount,
      setGoogleReviewEnabled,
      setGooglePlaceId,
      setSourceUrls,
      setNotificationConfig,
      setHandoffTargets,
      setCollectionFields
    },
    hasChanges,
    saving,
    isDeleting,
    handleSaveAll,
    handleDelete,
    applyTemplate
  }
}
