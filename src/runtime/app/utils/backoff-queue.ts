export interface BackoffQueueOptions {
  delays: number[]
  repeatLast?: boolean
  onTick: (index: number) => void | Promise<void>
}

export interface BackoffQueue {
  start: () => void
  clear: () => void
  isRunning: () => boolean
}

export function createBackoffQueue(options: BackoffQueueOptions): BackoffQueue {
  const { delays, onTick } = options
  let timer: ReturnType<typeof setTimeout> | undefined
  let running = false
  let generation = 0

  const clear = () => {
    generation++
    running = false
    clearTimeout(timer)
    timer = undefined
  }

  const start = () => {
    clear()
    if (delays.length === 0)
      return

    running = true
    const currentGeneration = generation
    const schedule = (index: number, delay: number) => {
      timer = setTimeout(async () => {
        await onTick(index)
        if (!running || currentGeneration !== generation)
          return
        const hasNext = index < delays.length - 1
        if (hasNext) {
          const nextDelay = delays[index + 1]! - delays[index]!
          schedule(index + 1, nextDelay)
        }
        else if (options.repeatLast) {
          schedule(index + 1, delays[delays.length - 1]!)
        }
        else {
          running = false
        }
      }, delay)
    }
    schedule(0, delays[0]!)
  }

  const isRunning = () => running

  return { start, clear, isRunning }
}
