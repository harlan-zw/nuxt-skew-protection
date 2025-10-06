# Nuxt Skew Protection

[![npm version][npm-version-src]][npm-version-href]
[![npm downloads][npm-downloads-src]][npm-downloads-href]
[![License][license-src]][license-href]
[![Nuxt][nuxt-src]][nuxt-href]

<p align="center">
<table>
<tbody>
<td align="center">
<sub>Made possible by my <a href="https://github.com/sponsors/harlan-zw">Sponsor Program 💖</a><br> Follow me <a href="https://twitter.com/harlan_zw">@harlan_zw</a> 🐦 • Join <a href="https://discord.gg/275MBUBvgP">Discord</a> for help</sub><br>
</td>
</tbody>
</table>
</p>

## Why Nuxt Skew Protection?

Congrats on shipping that latest release! Unfortunately, many of your users are going to be using the previous version of your app
for hours to days afterwards until they refresh.

Finally fixed that SEO issue? Great, but crawlers will often hit your site and request build chunks that no longer exist, leading
to 500 errors and broken indexes.

You've just been "skewed"! Skew is the version difference between what your users are running and what is currently deployed.

While Nuxt helps us by hard-reloading on navigation when it detects a new release, it's often not enough to ensure a smooth experience for all users
and crawlers. Just check out one of Nuxt's top commented [issues](https://github.com/nuxt/nuxt/issues/29624).

Nuxt Skew Protection aims to solve skews by providing better UX on top of app updates as well as long-lived build assets to avoid breaking crawlers and old sessions.

## Features

- ⚡ **Instantly Adopted Releases** - Zero-config Real-time notifications to users when a new version is deployed.
- 🎯 **Intelligent User Notifications** - Avoid spamming your users by only sending update notifications when their chunks are outdated. No annoying popups for unrelated updates.
- 📦 **Long-lived Build Assets** - Avoid breaking crawlers or old sessions with previous build assets remain accessible.
- 🎨 **Headless UI** - Ship it quicker with a headless notification component that works perfectly with Nuxt UI.

## Installation

Install `nuxt-skew-protection` dependency to your project:

```bash
npx nuxi@latest module add nuxt-skew-protection
```

Nuxt Skew Protection is a [Nuxt SEO Pro](https://nuxtseo.com/pricing) module, **please see the [licensing](#license) for commercial use**.

## Documentation

[📖 Read the full documentation](https://nuxtseo.com/skew-protection) for more information.

## Sponsors

<p align="center">
  <a href="https://raw.githubusercontent.com/harlan-zw/static/main/sponsors.svg">
    <img src='https://raw.githubusercontent.com/harlan-zw/static/main/sponsors.svg'/>
  </a>
</p>

## License

#### Commercial License

Nuxt Skew Protection requires a [Nuxt SEO Pro License](https://nuxtseo.com/pro) when using it for commercial projects. With this license, your source code remains proprietary.

Commercial use includes:
- Use in commercial products or services
- Use in projects generating revenue
- Use in closed-source commercial applications

#### Open Source & Non-Commercial License

If you are creating an open source project or using this for non-commercial purposes (personal projects, educational use, non-profit organizations), you may use this project under the terms of the MIT License.

See [LICENSE](https://github.com/harlan-zw/nuxt-skew-protection/blob/main/LICENSE) for full details.

<!-- Badges -->
[npm-version-src]: https://img.shields.io/npm/v/nuxt-skew-protection/latest.svg?style=flat&colorA=18181B&colorB=28CF8D
[npm-version-href]: https://npmjs.com/package/nuxt-skew-protection

[npm-downloads-src]: https://img.shields.io/npm/dm/nuxt-skew-protection.svg?style=flat&colorA=18181B&colorB=28CF8D
[npm-downloads-href]: https://npmjs.com/package/nuxt-skew-protection

[license-src]: https://img.shields.io/github/license/harlan-zw/nuxt-skew-protection.svg?style=flat&colorA=18181B&colorB=28CF8D
[license-href]: https://github.com/harlan-zw/nuxt-skew-protection/blob/main/LICENSE.md

[nuxt-src]: https://img.shields.io/badge/Nuxt-18181B?logo=nuxt.js
[nuxt-href]: https://nuxt.com
