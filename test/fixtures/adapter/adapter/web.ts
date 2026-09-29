import { defineWebSubscribe } from '../../../../src/runtime/adapters'

export const subscribe = defineWebSubscribe<{ endpoint: string }>((config, onMessage) => {
  const source = new EventSource(`${config.endpoint}?from=file-adapter-web`)
  source.onmessage = event => onMessage({ version: event.data })
  return () => source.close()
})
