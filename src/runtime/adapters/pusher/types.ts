import { z } from 'zod'

export const pusherConfigSchema = z.object({
  // Client (subscribe)
  key: z.string().min(1, 'Pusher key is required'),
  cluster: z.string().min(1, 'Pusher cluster is required'),
  // Server (broadcast)
  appId: z.string().min(1, 'Pusher appId is required'),
  secret: z.string().min(1, 'Pusher secret is required'),
  // Optional
  channel: z.string().optional(),
  event: z.string().optional(),
})

export type PusherAdapterConfig = z.infer<typeof pusherConfigSchema>
