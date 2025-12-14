import type { SkewAdapterConfig } from '../types'
// @ts-expect-error virtual module
import { config as adapterConfig, subscribe } from '#skew-adapter'
import { defineNuxtPlugin, useNuxtApp, useRuntimeConfig } from 'nuxt/app'
import { SKEW_MESSAGE_TYPE } from '../../const'
import { createSkewConnection } from '../utils/create-skew-connection'

export type { SkewAdapterConfig }

export default defineNuxtPlugin({
  name: 'skew-protection:adapter-updates',
  async setup() {
    const nuxtApp = useNuxtApp()
    // @ts-expect-error untyped
    const adapterName = useRuntimeConfig().public.skewProtection.adapterName

    const config: SkewAdapterConfig = {
      channel: (adapterConfig as { channel?: string }).channel || 'skew-protection',
      adapterConfig,
    }

    await nuxtApp.callHook('skew:adapter:config', config)

    const skewConnection = createSkewConnection({
      name: `Adapter:${adapterName}`,
      setup(onMessage) {
        return subscribe(config.adapterConfig, (msg: { version?: string }) => {
          onMessage({ type: SKEW_MESSAGE_TYPE.VERSION, channel: config.channel, ...msg })
        })
      },
    })

    return { provide: { skewConnection } }
  },
})
