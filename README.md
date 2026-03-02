# Nuxt Skew Protection

[![npm version][npm-version-src]][npm-version-href]
[![npm downloads][npm-downloads-src]][npm-downloads-href]
[![Nuxt][nuxt-src]][nuxt-href]

> Solve Nuxt version skew with persistent assets and instant updates.

## Why Nuxt Skew Protection?

**Version skew** is a mismatch between your deployed build and the chunks running in user browsers and crawler sessions. It can lead to several issues:

- 🕷️ **Crawlers 404 on stale chunks** - Googlebot requests `_nuxt/builds/abc123.js` which no longer exists post-deploy, logging 500s and potentially impacting indexing
- 💥 **ChunkLoadError in production** - Users mid-session get `Failed to fetch dynamically imported module` when navigating to routes with invalidated chunks
- 🔄 **Delayed rollout** - Your latest release sits unloaded until users hard refresh, sometimes hours or days later

Nuxt's built-in behavior (hard-reload when a new deployment is detected) helps, but in many cases it's [not enough](https://github.com/nuxt/nuxt/issues/29624).

Nuxt Skew Protection solves this with proactive update prompts and persistent build assets across deploys.

## Features

- 🕷️ **Persistent Build Assets** - Previous build artifacts remain accessible, so crawlers and stale sessions never hit dead ends.
- ⚡ **Instant Update Prompts** - Zero-config real-time notifications on deploy. Users adopt your latest build immediately.
- 🎯 **Chunk-Aware Targeting** - Notifications fire only when the user's loaded chunks are invalidated. No noise for unrelated updates.
- 🎨 **Headless UI** - Drop-in notification component with first-class Nuxt UI support.
- 📊 **Live Connection Monitoring** - Track active users and version distribution in real-time for admin dashboards and rollout progress.
- 🔌 **Third-Party Adapters** - Real-time updates on any platform (including static sites) via [Pusher](https://pusher.com) or [Ably](https://ably.com).

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

Nuxt Skew Protection requires a [Nuxt SEO Pro license](https://nuxtseo.com/pro), see [LICENSE](https://github.com/harlan-zw/nuxt-skew-protection/blob/main/LICENSE) for full details.

<!-- Badges -->
[npm-version-src]: https://img.shields.io/npm/v/nuxt-skew-protection/latest.svg?style=flat&colorA=18181B&colorB=28CF8D
[npm-version-href]: https://npmjs.com/package/nuxt-skew-protection

[npm-downloads-src]: https://img.shields.io/npm/dm/nuxt-skew-protection.svg?style=flat&colorA=18181B&colorB=28CF8D
[npm-downloads-href]: https://npmjs.com/package/nuxt-skew-protection

[nuxt-src]: https://img.shields.io/badge/Nuxt-18181B?logo=nuxt
[nuxt-href]: https://nuxt.com
