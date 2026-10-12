import type { AdapterConfigResult } from '../types'
import { parseStringConfig } from '../types'

export interface PusherAdapterConfig {
  // Client (subscribe)
  key: string
  cluster: string
  // Server (broadcast)
  appId: string
  secret: string
  // Optional
  channel?: string
  event?: string
}

export type PusherClientConfig = Pick<PusherAdapterConfig, 'key' | 'cluster' | 'channel' | 'event'>

export function parsePusherConfig(input: unknown): AdapterConfigResult<PusherAdapterConfig> {
  return parseStringConfig(
    input,
    {
      key: 'Pusher key is required',
      cluster: 'Pusher cluster is required',
      appId: 'Pusher appId is required',
      secret: 'Pusher secret is required',
    },
    ['channel', 'event'],
  )
}
