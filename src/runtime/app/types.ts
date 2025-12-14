import type { UseEventSourceOptions, UseWebSocketOptions } from '@vueuse/core'
import type { Ref } from 'vue'

export interface SkewWebSocketConfig {
  url: string
  options: UseWebSocketOptions
}

export interface SkewSSEConfig {
  url: string
  options: UseEventSourceOptions<string>
}

export interface SkewAdapterConfig {
  channel: string
  adapterConfig: Record<string, unknown>
}

export interface ChunksOutdatedPayload {
  deletedChunks: string[]
  invalidatedModules: string[]
  passedReleases: string[]
}

export interface SkewConnection {
  connect: () => void
  disconnect: () => void
  buildId: string
  cookie: Ref<string | null | undefined>
}
