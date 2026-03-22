import { z } from 'zod'

export const createAgentLinkSchema = z.object({
  slug: z
    .string()
    .min(2)
    .max(60)
    .regex(
      /^[a-z0-9][a-z0-9-]*[a-z0-9]$/,
      'Slug must be lowercase alphanumeric with hyphens, at least 2 characters'
    ),
  agentId: z.string().min(1),
  name: z.string().min(2).max(120),
  description: z.string().max(500).optional()
})

export const updateAgentLinkSchema = z.object({
  agentId: z.string().min(1).optional(),
  name: z.string().min(2).max(120).optional(),
  description: z.string().max(500).nullable().optional(),
  isActive: z.boolean().optional()
})
