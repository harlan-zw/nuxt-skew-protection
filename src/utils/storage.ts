// This file provides storage utilities that work both in Nuxt runtime and testing
import type { Storage } from 'unstorage'
import { createStorage } from 'unstorage'

let _storage: Storage | null = null
let _storageConfig: any = null

export function getSkewProtectionStorage(): Storage {
  if (_storage) {
    return _storage
  }

  // Create unstorage instance with user's configuration (or default)
  // This works in all environments: build time, runtime, and Cloudflare Workers
  _storage = _storageConfig ? createStorage(_storageConfig) : createStorage()
  return _storage
}

export function configureSkewProtectionStorage(config: any): void {
  _storageConfig = config
  _storage = null // Reset storage to force recreation with new config
}
