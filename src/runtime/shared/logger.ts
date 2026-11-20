const tag = '[nuxt-skew-protection]'
let debugEnabled = false

export const logger = {
  debug(...args: unknown[]) {
    if (debugEnabled) {
      // eslint-disable-next-line no-console -- Use the browser console for opt-in debug logs.
      console.debug(tag, ...args)
    }
  },
  warn(...args: unknown[]) {
    console.warn(tag, ...args)
  },
  error(...args: unknown[]) {
    console.error(tag, ...args)
  },
}

export function init(debug: boolean) {
  debugEnabled = debug
}
