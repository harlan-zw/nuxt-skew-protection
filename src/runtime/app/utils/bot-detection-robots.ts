import { useBotDetection } from '#imports'

export function useSkewBotDetection(): boolean {
  return useBotDetection().isBot.value
}
