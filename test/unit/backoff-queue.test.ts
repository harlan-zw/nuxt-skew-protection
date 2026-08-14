import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createBackoffQueue } from '../../src/runtime/app/utils/backoff-queue'

describe('createBackoffQueue', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('calls onTick for each delay', async () => {
    const onTick = vi.fn()
    const queue = createBackoffQueue({
      delays: [0, 100, 200],
      onTick,
      onError: () => {},
    })

    queue.start()

    await vi.advanceTimersByTimeAsync(0)
    expect(onTick).toHaveBeenCalledTimes(1)
    expect(onTick).toHaveBeenCalledWith(0)

    await vi.advanceTimersByTimeAsync(100)
    expect(onTick).toHaveBeenCalledTimes(2)
    expect(onTick).toHaveBeenCalledWith(1)

    await vi.advanceTimersByTimeAsync(100)
    expect(onTick).toHaveBeenCalledTimes(3)
    expect(onTick).toHaveBeenCalledWith(2)
  })

  it('clear cancels pending timers', async () => {
    const onTick = vi.fn()
    const queue = createBackoffQueue({
      delays: [0, 100, 200],
      onTick,
      onError: () => {},
    })

    queue.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(onTick).toHaveBeenCalledTimes(1)

    queue.clear()

    await vi.advanceTimersByTimeAsync(300)
    expect(onTick).toHaveBeenCalledTimes(1)
  })

  it('start resets the queue if already running', async () => {
    const onTick = vi.fn()
    const queue = createBackoffQueue({
      delays: [0, 100, 200],
      onTick,
      onError: () => {},
    })

    queue.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(onTick).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(50)

    // restart before 100ms timer fires
    queue.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(onTick).toHaveBeenCalledTimes(2) // second immediate call

    await vi.advanceTimersByTimeAsync(100)
    expect(onTick).toHaveBeenCalledTimes(3) // new 100ms timer

    await vi.advanceTimersByTimeAsync(100)
    expect(onTick).toHaveBeenCalledTimes(4) // new 200ms timer
  })

  it('isRunning returns correct state', () => {
    const onTick = vi.fn()
    const queue = createBackoffQueue({
      delays: [100],
      onTick,
      onError: () => {},
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
      onError: () => {},
    })

    queue.start()
    expect(onTick).not.toHaveBeenCalled()
    expect(queue.isRunning()).toBe(false)
  })

  it('reports rejected ticks and continues retrying', async () => {
    const error = new Error('network unavailable')
    const onTick = vi.fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce(undefined)
    const onError = vi.fn()
    const queue = createBackoffQueue({
      delays: [0, 10],
      repeatLast: true,
      onTick,
      onError,
    })

    queue.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(onError).toHaveBeenCalledWith(error, 0)
    expect(queue.isRunning()).toBe(true)

    await vi.advanceTimersByTimeAsync(10)
    expect(onTick).toHaveBeenCalledTimes(2)
    expect(queue.isRunning()).toBe(true)
  })
})
