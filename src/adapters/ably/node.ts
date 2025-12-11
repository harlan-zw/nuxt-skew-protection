import type { AblyAdapterConfig } from './types'
import { defineNodeBroadcast } from '../types'

export const broadcast = defineNodeBroadcast<AblyAdapterConfig>(async (config, version) => {
  const channelName = config.channel || 'skew-protection'
  const eventName = config.event || 'VersionUpdated'

  const [keyId, keySecret] = config.key.split(':')

  const url = `https://rest.ably.io/channels/${encodeURIComponent(channelName)}/messages`

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`,
    },
    body: JSON.stringify({
      name: eventName,
      data: JSON.stringify({ version }),
    }),
  })

  if (!response.ok) {
    throw new Error(`Ably broadcast failed: ${response.status} ${await response.text()}`)
  }
})
