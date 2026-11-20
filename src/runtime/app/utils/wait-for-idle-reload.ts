const ACTIVITY_EVENTS = [
  'mousemove',
  'mousedown',
  'resize',
  'keydown',
  'touchstart',
  'wheel',
]
const IDLE_TIMEOUT_MS = 60_000

// Keep this chunk independent of VueUse, which the client entry uses for online status.
export function waitForIdleReload(): Promise<void> {
  if (document.visibilityState === 'hidden')
    return Promise.resolve()

  return new Promise((resolve) => {
    const listeners = new AbortController()
    const options = { passive: true, signal: listeners.signal }
    let idleAt = performance.now() + IDLE_TIMEOUT_MS
    let timer: ReturnType<typeof setTimeout>

    const finish = () => {
      clearTimeout(timer)
      listeners.abort()
      resolve()
    }
    const checkIdle = () => {
      const remaining = idleAt - performance.now()
      if (remaining > 0)
        timer = setTimeout(checkIdle, remaining)
      else
        finish()
    }
    const onActivity = () => {
      idleAt = performance.now() + IDLE_TIMEOUT_MS
    }

    for (const event of ACTIVITY_EVENTS)
      window.addEventListener(event, onActivity, options)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden')
        finish()
      else
        onActivity()
    }, options)
    timer = setTimeout(checkIdle, IDLE_TIMEOUT_MS)
  })
}
