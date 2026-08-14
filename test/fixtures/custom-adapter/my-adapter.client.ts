export function subscribe(config: { endpoint: string }) {
  ;(globalThis as any).__CUSTOM_ADAPTER_ENDPOINT__ = config.endpoint
  return () => {}
}
