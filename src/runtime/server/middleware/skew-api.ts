import { defineEventHandler } from 'h3'
import { isClientOutdated, triggerOutdatedClientEvent } from '../utils'

/**
 * Middleware for API routes
 * Detects version skew and triggers hook for user handling
 */
export default defineEventHandler(async (event) => {
  const url = event.node.req.url || ''

  // Only handle API routes (excluding internal _skew routes)
  if (!url.startsWith('/api/') || url.startsWith('/_skew')) {
    return
  }

  // Check if client is outdated
  const { outdated, clientVersion, currentVersion } = isClientOutdated(event)

  // Early return: if client is up-to-date, no action needed
  if (!outdated) {
    return
  }

  // Skew detected - trigger event for user to handle
  if (clientVersion && currentVersion) {
    await triggerOutdatedClientEvent(event, clientVersion, currentVersion)
  }
})
