import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createBackoffQueue } from '../../src/runtime/app/utils/backoff-queue'

describe('createBackoffQueue', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('calls onTick for each delay', () => {
    const onTick = vi.fn()
    const queue = createBackoffQueue({
      delays: [0, 100, 200],
      onTick,
    })

    queue.start()

    vi.advanceTimersByTime(0)
    expect(onTick).toHaveBeenCalledTimes(1)
    expect(onTick).toHaveBeenCalledWith(0)

    vi.advanceTimersByTime(100)
    expect(onTick).toHaveBeenCalledTimes(2)
    expect(onTick).toHaveBeenCalledWith(1)

    vi.advanceTimersByTime(100)
    expect(onTick).toHaveBeenCalledTimes(3)
    expect(onTick).toHaveBeenCalledWith(2)
  })

  it('clear cancels pending timers', () => {
    const onTick = vi.fn()
    const queue = createBackoffQueue({
      delays: [0, 100, 200],
      onTick,
    })

    queue.start()
    vi.advanceTimersByTime(0)
    expect(onTick).toHaveBeenCalledTimes(1)

    queue.clear()

    vi.advanceTimersByTime(300)
    expect(onTick).toHaveBeenCalledTimes(1)
  })

  it('start resets the queue if already running', () => {
    const onTick = vi.fn()
    const queue = createBackoffQueue({
      delays: [0, 100, 200],
      onTick,
    })

    queue.start()
    vi.advanceTimersByTime(0)
    expect(onTick).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(50)

    // restart before 100ms timer fires
    queue.start()
    vi.advanceTimersByTime(0)
    expect(onTick).toHaveBeenCalledTimes(2) // second immediate call

    vi.advanceTimersByTime(100)
    expect(onTick).toHaveBeenCalledTimes(3) // new 100ms timer

    vi.advanceTimersByTime(100)
    expect(onTick).toHaveBeenCalledTimes(4) // new 200ms timer
  })

  it('isRunning returns correct state', () => {
    const onTick = vi.fn()
    const queue = createBackoffQueue({
      delays: [100],
      onTick,
    })

    expect(queue.isRunning()).toBe(false)

    queue.start()
    expect(queue.isRunning()).toBe(true)

    queue.clear()
    expect(queue.isRunning()).toBe(false)
  })

  it('handles empty delays array', () => {
    const onTick = vi.fn()
    const queue = createBackoffQueue({
      delays: [],
      onTick,
    })

    queue.start()
    expect(onTick).not.toHaveBeenCalled()
    expect(queue.isRunning()).toBe(false)
  })
})
