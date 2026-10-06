import { defineEventHandler } from 'nuxt/server'

export default defineEventHandler(() => new Response('<h1>Shared cache fixture</h1>', {
  headers: {
    'content-type': 'text/html',
    'cache-control': 'public, s-maxage=300',
    'set-cookie': 'session=kept; Expires=Wed, 01 Jan 2031 00:00:00 GMT; Path=/',
  },
}))
