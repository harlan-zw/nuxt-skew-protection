import type { SkewBroadcastResult, SkewUpdateMessage } from './types'

type SkewAdapterProvider = 'ably' | 'pusher'

const safePayloadBytes: Record<SkewAdapterProvider, number> = {
  ably: 60 * 1024,
  pusher: 9_500,
}

interface PreparedSkewUpdate {
  update: SkewUpdateMessage
  result: SkewBroadcastResult
}

const jsonByteLength = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength

export function prepareSkewUpdate(provider: SkewAdapterProvider, update: SkewUpdateMessage): PreparedSkewUpdate {
  const maxBytes = safePayloadBytes[provider]
  const originalByteLength = jsonByteLength(update)

  if (originalByteLength <= maxBytes) {
    return {
      update,
      result: {
        _tag: 'complete',
        byteLength: originalByteLength,
        maxBytes,
      },
    }
  }

  const notificationOnlyUpdate: SkewUpdateMessage = {
    version: update.version,
    manifest: {
      id: update.manifest.id,
      timestamp: update.manifest.timestamp,
    },
  }

  return {
    update: notificationOnlyUpdate,
    result: {
      _tag: 'notification-only',
      originalByteLength,
      byteLength: jsonByteLength(notificationOnlyUpdate),
      maxBytes,
    },
  }
}
