# Nuxt Skew Protection

[![npm version][npm-version-src]][npm-version-href]
[![npm downloads][npm-downloads-src]][npm-downloads-href]
[![Nuxt][nuxt-src]][nuxt-href]

> Keep old build assets available and notify users when their app needs an update.

## Why Nuxt Skew Protection?

**Version skew** happens when a browser or crawler still uses chunks from an older deployment. You may see:

- 🕷️ **Crawlers 404 on stale chunks**: Googlebot requests a chunk that no longer exists after deployment.
- 💥 **ChunkLoadError in production**: Users see `Failed to fetch dynamically imported module` when a route needs a deleted chunk.
- 🔄 **Delayed rollout**: Users keep running an old version until they refresh.

Nuxt can reload the page after detecting a new deployment. It still has [limits](https://github.com/nuxt/nuxt/issues/29624).

Nuxt Skew Protection keeps previous build assets available across deployments and provides update notification logic.

## Features

- 🕷️ **Persistent Build Assets**: Keep previous build assets available for crawlers and users on old versions.
- ⚡ **Instant Update Prompts**: Detect deployments through polling, SSE, WebSockets, or an external provider.
- 🎯 **Chunk-Aware Targeting**: Prompt users when a deployment invalidates their loaded chunks.
- 🎨 **Headless UI**: Use the headless notification component with your own template or a Nuxt UI example.
- 📊 **Live Connection Monitoring**: Track active users and version distribution in real-time for admin dashboards and rollout progress.
- 🔌 **Third-Party Adapters**: Real-time updates on any platform (including static sites) via [Pusher](https://pusher.com) or [Ably](https://ably.com).

## Installation

Add `nuxt-skew-protection` to your project:

```bash
npx nuxi@latest module add nuxt-skew-protection
```

> [!TIP]
> Generate an Agent Skill for this package using [skilld](https://github.com/harlan-zw/skilld):
> ```bash
> npx skilld add nuxt-skew-protection
> ```

## Documentation

[📖 Read the documentation](https://nuxtseo.com/skew-protection).

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
