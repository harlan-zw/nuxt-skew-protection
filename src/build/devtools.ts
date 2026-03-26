import type { Resolver } from '@nuxt/kit'
import type { Nuxt } from 'nuxt/schema'
import { addServerHandler, useNuxt } from '@nuxt/kit'
import { setupDevToolsUI as _setupDevToolsUI } from 'nuxtseo-shared/devtools'

export function setupDevToolsUI(resolve: Resolver['resolve'], nuxt: Nuxt = useNuxt()) {
  _setupDevToolsUI({
    route: '/__nuxt-skew-protection',
    name: 'nuxt-skew-protection',
    title: 'Skew Protection',
    icon: 'carbon:version',
  }, resolve, nuxt)

  // Register debug endpoints for devtools data
  addServerHandler({
    route: '/__skew-devtools/debug',
    method: 'get',
    handler: resolve('./runtime/server/routes/__skew-devtools/debug.get'),
  })

  addServerHandler({
    route: '/__skew-devtools/debug-production',
    method: 'get',
    handler: resolve('./runtime/server/routes/__skew-devtools/debug-production.get'),
  })
}
