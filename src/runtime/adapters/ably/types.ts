import { z } from 'zod'

export const ablyConfigSchema = z.object({
  key: z.string().min(1, 'Ably key is required'),
  authUrl: z.string().min(1, 'Ably authUrl is required'),
  clientId: z.string().optional(),
  channel: z.string().optional(),
  event: z.string().optional(),
})

export type AblyAdapterConfig = z.infer<typeof ablyConfigSchema>

export type AblyClientConfig = Pick<AblyAdapterConfig, 'authUrl' | 'clientId' | 'channel' | 'event'>
