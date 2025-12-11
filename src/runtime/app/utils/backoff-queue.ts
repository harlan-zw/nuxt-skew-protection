export interface BackoffQueueOptions {
  delays: number[]
  onTick: (index: number) => void
}

export interface BackoffQueue {
  start: () => void
  clear: () => void
  isRunning: () => boolean
}

export function createBackoffQueue(options: BackoffQueueOptions): BackoffQueue {
  const { delays, onTick } = options
  let timers: ReturnType<typeof setTimeout>[] = []

  const clear = () => {
    timers.forEach(clearTimeout)
    timers = []
  }

  const start = () => {
    clear()
    delays.forEach((delay, i) => {
      timers.push(setTimeout(() => onTick(i), delay))
    })
  }

  const isRunning = () => timers.length > 0

  return { start, clear, isRunning }
}
