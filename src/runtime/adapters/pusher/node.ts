import type { PusherAdapterConfig } from './types'
import { createHash, createHmac } from 'node:crypto'
import { defineNodeBroadcast } from '../../../utils'
import { SKEW_DEFAULT_CHANNEL, SKEW_MESSAGE_TYPE } from '../../const'

export const broadcast = defineNodeBroadcast<PusherAdapterConfig>(async (config, version) => {
  const channelName = config.channel || SKEW_DEFAULT_CHANNEL
  const eventName = config.event || SKEW_MESSAGE_TYPE.VERSION

  const body = JSON.stringify({
    name: eventName,
    channel: channelName,
    data: JSON.stringify({ version }),
  })

  const timestamp = Math.floor(Date.now() / 1000)
  const bodyMd5 = createHash('md5').update(body).digest('hex')
  const stringToSign = `POST\n/apps/${config.appId}/events\nauth_key=${config.key}&auth_timestamp=${timestamp}&auth_version=1.0&body_md5=${bodyMd5}`
  const signature = createHmac('sha256', config.secret!).update(stringToSign).digest('hex')

  const url = `https://api-${config.cluster}.pusher.com/apps/${config.appId}/events?auth_key=${config.key}&auth_timestamp=${timestamp}&auth_version=1.0&body_md5=${bodyMd5}&auth_signature=${signature}`

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  })

  if (!response.ok) {
    throw new Error(`Pusher broadcast failed: ${response.status} ${await response.text()}`)
  }
})
