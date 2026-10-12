import type { AdapterConfigResult } from '../types'
import { parseStringConfig } from '../types'

export interface AblyAdapterConfig {
  key: string
  authUrl: string
  clientId?: string
  channel?: string
  event?: string
}

export type AblyClientConfig = Pick<AblyAdapterConfig, 'authUrl' | 'clientId' | 'channel' | 'event'>

export function parseAblyConfig(input: unknown): AdapterConfigResult<AblyAdapterConfig> {
  return parseStringConfig(
    input,
    { key: 'Ably key is required', authUrl: 'Ably authUrl is required' },
    ['clientId', 'channel', 'event'],
  )
}
