# Nuxt Skew Protection

[![npm version][npm-version-src]][npm-version-href]
[![npm downloads][npm-downloads-src]][npm-downloads-href]
[![Nuxt][nuxt-src]][nuxt-href]

> Keep old Nuxt build assets available, detect new deployments, and move active sessions onto the new client.

## Why Nuxt Skew Protection?

**Version skew** exists when a browser is still running one release after the deployment target has moved to another. The old client may request a lazy chunk that disappeared, or call a server endpoint whose contract changed.

- 🕷️ **Stale asset requests**: crawlers and browsers request an old content-hashed file after deployment.
- 💥 **Lazy import failures**: an active session navigates to code that it has not loaded yet.
- 🔄 **Old clients**: open tabs keep running old code until they reload.
- 🔌 **Server contract skew**: an old client calls the new server API.

Nuxt's built-in behavior (hard-reload when it detects a new deployment) helps, but in many cases it's [not enough](https://github.com/nuxt/nuxt/issues/29624).

The module retains immutable build assets and reacts to Nuxt's deployment manifest updates. Polling, SSE, [WebSocket](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket), and external adapters differ only in how quickly the client learns about a release.

The portable mode does not retain old server endpoints. If an API contract changes, use a compatible rollout or platform deployment affinity. Reload prompts reduce that exposure window but cannot remove it.

## Features

- 🕷️ **Retained build assets**: old content-hashed assets are restored into each deployment output.
- ⚡ **Deployment updates**: use Nuxt polling, SSE, WebSocket, Pusher, or Ably.
- 🎨 **Update UI**: prompt, reload immediately, wait for idle, or handle the Nuxt hook yourself.
- 📊 **Connection monitoring**: inspect active versions when using SSE or WebSocket.
- 🔒 **Safe adapter config**: server secrets stay out of the generated client bundle.

## Installation

Install `nuxt-skew-protection` dependency to your project:

```bash
npx nuxi@latest module add nuxt-skew-protection
```

> [!TIP]
> Generate an Agent Skill for this package using [skilld](https://github.com/harlan-zw/skilld):
> ```bash
> npx skilld add nuxt-skew-protection
> ```

## Documentation

[📖 Read the full documentation](https://nuxtseo.com/skew-protection) for more information.

## Sponsors

<p align="center">
  <a href="https://raw.githubusercontent.com/harlan-zw/static/main/sponsors.svg">
    <img src='https://raw.githubusercontent.com/harlan-zw/static/main/sponsors.svg' alt="Sponsors"/>
  </a>
</p>

## License

[MIT License](https://github.com/harlan-zw/nuxt-skew-protection/blob/main/LICENSE.md)

<!-- Badges -->
[npm-version-src]: https://img.shields.io/npm/v/nuxt-skew-protection/latest.svg?style=flat&colorA=18181B&colorB=28CF8D
[npm-version-href]: https://npmjs.com/package/nuxt-skew-protection

[npm-downloads-src]: https://img.shields.io/npm/dm/nuxt-skew-protection.svg?style=flat&colorA=18181B&colorB=28CF8D
[npm-downloads-href]: https://npmjs.com/package/nuxt-skew-protection

[nuxt-src]: https://img.shields.io/badge/Nuxt-18181B?logo=nuxt
[nuxt-href]: https://nuxt.com
