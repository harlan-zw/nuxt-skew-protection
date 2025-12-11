import { z } from 'zod'

export const ablyConfigSchema = z.object({
  key: z.string().min(1, 'Ably key is required'),
  channel: z.string().optional(),
  event: z.string().optional(),
})

export type AblyAdapterConfig = z.infer<typeof ablyConfigSchema>
