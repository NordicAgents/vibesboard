import type { VibeAgent } from '@/lib/types'
import type { BotResponse } from './message-types'

const WHATSAPP_LIMITS = {
  interactiveBodyText: 1024,
  buttonTitle: 20,
  listRowTitle: 24,
  listRowDescription: 72
} as const

function normalizeLabel(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * Extract quick suggestions from agent response
 */
export function extractQuickSuggestions(text: string): string[] {
  const match = text.match(/<!--SUGGESTIONS:(\{[\s\S]*?\})-->/)
  if (!match) return []

  try {
    const parsed = JSON.parse(match[1])
    const suggestions = parsed?.suggestions ?? []

    // Validate suggestions
    return suggestions
      .filter((s: any) => typeof s === 'string' && s.length <= 80)
      .slice(0, 3) // WhatsApp buttons max: 3
  } catch {
    return []
  }
}

/**
 * Check if response contains completion marker
 */
export function hasCompletionMarker(text: string): boolean {
  return (
    text.includes('[COLLECTION_COMPLETE]') ||
    text.includes('[INFO_COMPLETE]') ||
    /<!--CHAT_COMPLETE:(\{.*?\})-->/.test(text)
  )
}

/**
 * Strip all markers from text for display
 */
export function stripMarkers(text: string): string {
  return text
    .replace(/\[COLLECTION_COMPLETE\]/g, '')
    .replace(/\[INFO_COMPLETE\]/g, '')
    .replace(/<!--CHAT_COMPLETE:(\{.*?\})-->/g, '')
    .replace(/<!--SUGGESTIONS:(\{[\s\S]*?\})-->/g, '')
    .trim()
}

/**
 * Format agent response for WhatsApp
 */
export function formatResponseForWhatsApp(
  agent: VibeAgent,
  responseText: string,
  isComplete: boolean = false
): BotResponse {
  const cleanText = stripMarkers(responseText)

  // Don't show suggestions if conversation is complete
  if (isComplete) {
    return {
      type: 'text',
      text: cleanText
    }
  }

  // Check suggestion mode
  const suggestionMode = agent.quickSuggestionsMode ?? 'smart'

  if (suggestionMode === 'off') {
    return {
      type: 'text',
      text: cleanText
    }
  }

  // Extract suggestions
  const suggestions = extractQuickSuggestions(responseText)

  if (suggestions.length === 0) {
    return {
      type: 'text',
      text: cleanText
    }
  }

  // Interactive messages have stricter text limits; fall back to plain text if too long.
  if (cleanText.length > WHATSAPP_LIMITS.interactiveBodyText) {
    return {
      type: 'text',
      text: cleanText
    }
  }

  const normalizedSuggestions = suggestions
    .map(normalizeLabel)
    .filter(Boolean)
    .slice(0, 10)

  // WhatsApp supports up to 3 reply buttons, with a very short title limit.
  const canUseButtons =
    normalizedSuggestions.length > 0 &&
    normalizedSuggestions.length <= 3 &&
    normalizedSuggestions.every(s => s.length <= WHATSAPP_LIMITS.buttonTitle)

  if (canUseButtons) {
    return {
      type: 'buttons',
      text: cleanText,
      buttons: normalizedSuggestions
    }
  }

  // Otherwise use a list (more forgiving + supports descriptions).
  return {
    type: 'list',
    text: cleanText,
    options: normalizedSuggestions.map((suggestion, index) => ({
      id: `suggestion_${index}`,
      title: suggestion.substring(0, WHATSAPP_LIMITS.listRowTitle),
      description:
        suggestion.length > WHATSAPP_LIMITS.listRowTitle
          ? suggestion.substring(0, WHATSAPP_LIMITS.listRowDescription)
          : undefined
    }))
  }
}

/**
 * Format completion message for WhatsApp
 */
export function formatCompletionMessage(agent: VibeAgent): BotResponse {
  const mode = agent.mode

  const message =
    mode === 'collector'
      ? 'Thank you for sharing your feedback! Your response has been recorded. 🙏'
      : "I'm glad I could help! Feel free to reach out again if you have more questions. 👋"

  return {
    type: 'text',
    text: message
  }
}
