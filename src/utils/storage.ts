// This file provides storage utilities that work both in Nuxt runtime and testing
import type { Storage } from 'unstorage'

let _storage: Storage | null = null

export function getSkewProtectionStorage(): Storage {
  if (_storage) {
    return _storage
  }

  // Fallback for testing environment
  if (process.env.NODE_ENV === 'test' || process.env.VITEST) {
    const { createStorage } = require('unstorage')
    _storage = createStorage()
    return _storage
  }

  // In Nuxt runtime, useStorage will be available
  try {
    const { useStorage } = require('#imports')
    _storage = useStorage('skew-protection')
    return _storage
  }
  catch {
    // During build time, create a temporary memory storage
    // This allows the module to work during build without Nuxt runtime context
    console.warn('[skew-protection] Nuxt runtime context not available, using temporary memory storage')
    const { createStorage } = require('unstorage')
    _storage = createStorage()
    return _storage
  }
}

export function setSkewProtectionStorage(storage: Storage): void {
  _storage = storage
}

// Mock storage for testing
export function createMockStorage(): Storage {
  return {
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
    getKeys: async () => [],
    clear: async () => {},
    dispose: async () => {},
  } as unknown as Storage
}
