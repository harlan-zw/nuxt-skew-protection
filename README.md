<h1><a href="https://nuxtseo.com"><img src=".github/assets/icon.svg" width="40" height="40" alt="Nuxt SEO" align="top"></a> Nuxt Skew Protection</h1>

[![npm version][npm-version-src]][npm-version-href]
[![npm downloads][npm-downloads-src]][npm-downloads-href]
[![License][license-src]][license-href]
[![Nuxt][nuxt-src]][nuxt-href]
[![Skill repository on skilld.dev][skilld-src]][skilld-href]

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
> Using an AI agent? Get the nuxt-skew-protection Skill on [skilld.dev/gh/harlan-zw/nuxt-skew-protection](https://skilld.dev/gh/harlan-zw/nuxt-skew-protection).

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
[npm-version-src]: https://img.shields.io/npm/v/nuxt-skew-protection/latest.svg?style=flat&labelColor=16152b&color=00a63e
[npm-version-href]: https://npmjs.com/package/nuxt-skew-protection

[npm-downloads-src]: https://img.shields.io/npm/dm/nuxt-skew-protection.svg?style=flat&labelColor=16152b&color=00a63e
[npm-downloads-href]: https://npmjs.com/package/nuxt-skew-protection

[license-src]: https://img.shields.io/github/license/harlan-zw/nuxt-skew-protection.svg?style=flat&labelColor=16152b&color=00a63e
[license-href]: https://github.com/harlan-zw/nuxt-skew-protection/blob/main/LICENSE.md

[nuxt-src]: https://img.shields.io/badge/Nuxt-16152b?logo=nuxt&style=flat
[nuxt-href]: https://nuxt.com

[skilld-src]: https://skilld.dev/b/harlan-zw/nuxt-skew-protection?style=flat&labelColor=16152b&color=00a63e&logoColor=ffffff
[skilld-href]: https://skilld.dev/gh/harlan-zw/nuxt-skew-protection
