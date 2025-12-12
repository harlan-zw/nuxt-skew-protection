import type { SkewAdapter } from '../../../src/runtime/adapters/types'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Mock adapter for testing - stores messages in memory
const messages: Array<{ version: string }> = []
const subscribers: Array<(msg: { version: string }) => void> = []

export const mockAdapter: SkewAdapter = {
  name: 'mock',
  subscribe(onMessage) {
    subscribers.push(onMessage)
    // Deliver any pending messages
    messages.forEach(msg => onMessage(msg))
    return () => {
      const idx = subscribers.indexOf(onMessage)
      if (idx > -1)
        subscribers.splice(idx, 1)
    }
  },
  async broadcast(version) {
    const msg = { version }
    messages.push(msg)
    subscribers.forEach(sub => sub(msg))
  },
}

export default defineNuxtConfig({
  modules: ['../../../src/module'],
  compatibilityDate: '2024-11-01',

  skewProtection: {
    debug: true,
    updateStrategy: mockAdapter,
    storage: {
      driver: 'fs',
      base: join(__dirname, '.skew-storage'),
    },
    retentionDays: 1,
    maxNumberOfVersions: 3,
  },

  runtimeConfig: {
    app: {
      buildId: process.env.NUXT_DEPLOYMENT_ID || undefined,
    },
    public: {
      deploymentId: process.env.NUXT_DEPLOYMENT_ID || 'dpl-adapter-v1',
    },
  },
})
