/**
 * Shared cookie configuration and utilities for skew protection
 */

export const COOKIE_CONFIG = {
  path: '/',
  sameSite: 'strict' as const,
  maxAge: 60 * 60 * 24 * 60, // 60 days
}
