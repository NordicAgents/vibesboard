/**
 * Strip newlines and control characters from user-controlled strings before
 * interpolating them into AI system prompts to prevent prompt injection.
 */
export function sanitizeForPrompt(value: string): string {
  return value.replace(/[\r\n\x00-\x1F\x7F]/g, ' ').trim()
}
