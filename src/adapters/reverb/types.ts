import { z } from 'zod'

export const reverbConfigSchema = z.object({
  key: z.string().min(1, 'Reverb key is required'),
  appId: z.string().min(1, 'Reverb appId is required'),
  secret: z.string().min(1, 'Reverb secret is required'),
  host: z.string().min(1, 'Reverb host is required'),
  port: z.number().optional(),
  useTLS: z.boolean().optional(),
  channel: z.string().optional(),
  event: z.string().optional(),
})

export type ReverbAdapterConfig = z.infer<typeof reverbConfigSchema>
