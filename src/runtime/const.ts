export const SKEW_MESSAGE_TYPE = {
  VERSION: 'version',
  CONNECTED: 'connected',
  PING: 'ping',
} as const

export type SkewMessageType = typeof SKEW_MESSAGE_TYPE[keyof typeof SKEW_MESSAGE_TYPE]

export const SKEW_DEFAULT_CHANNEL = 'skew-protection'
