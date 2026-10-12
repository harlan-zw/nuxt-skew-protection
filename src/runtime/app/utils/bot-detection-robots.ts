import { useBotDetection } from '#robots/app'

export function useSkewBotDetection(): boolean {
  return useBotDetection().isBot.value
}
