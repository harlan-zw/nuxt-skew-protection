import type { UseEventSourceOptions, UseWebSocketOptions } from '@vueuse/core'
import type { NuxtAppManifestMeta } from 'nuxt/app'
import type { Ref } from 'vue'
import type { BackoffQueue } from './utils/backoff-queue'

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
  send: (data: unknown) => void
  sendRoute: (route: string) => void
  subscribeStats: () => void
  buildId: string
  cookie?: Ref<string | null | undefined>
}

/** Detection work belongs to the app, independently of mounted consumers. */
export interface SkewVersionDetection {
  queue: BackoffQueue
  lastDetectedServerVersion: string | undefined
  inFlight: Promise<NuxtAppManifestMeta | null> | undefined
}
