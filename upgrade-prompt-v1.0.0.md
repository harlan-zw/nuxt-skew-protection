# Upgrade Guide: nuxt-skew-protection v0.x to v1.0.0

You are helping me upgrade nuxt-skew-protection from v0.x to v1.0.0 in my Nuxt project.

## Breaking Changes

### 1. Hook Renamed

**What changed:** `skew-protection:chunks-outdated` → `skew:chunks-outdated`

**Search my codebase for:** `skew-protection:chunks-outdated`

**Regex pattern:** `skew-protection:chunks-outdated`

**Before:**
```ts
nuxtApp.hooks.hook('skew-protection:chunks-outdated', callback)
```

**After:**
```ts
nuxtApp.hooks.hook('skew:chunks-outdated', callback)
```

### 2. Composable Return Renamed

**What changed:** `isOutdated` → `isAppOutdated` on the `useSkewProtection()` return.

**Search my codebase for:** `isOutdated`

**Regex pattern:** `isOutdated(?!Payload|\.)`

**Before:**
```ts
const { isOutdated } = useSkewProtection()
```

**After:**
```ts
const { isAppOutdated } = useSkewProtection()
```

### 3. Config Renamed

**What changed:** `bundlePreviousDeploymentChunks` → `bundleAssets`

**Search my codebase for:** `bundlePreviousDeploymentChunks`

**Regex pattern:** `bundlePreviousDeploymentChunks`

**Before:**
```ts
const before = { skewProtection: { bundlePreviousDeploymentChunks: true } }
```

**After:**
```ts
const after = { skewProtection: { bundleAssets: true } }
```

### 4. Route Prefix Changed

**What changed:** `/_skew/` → `/__skew/` (double underscore)

**Search my codebase for:** `/_skew/`

**Regex pattern:** `/_skew/`

**Before:**
```ts
$fetch('/_skew/sse')
```

**After:**
```ts
$fetch('/__skew/sse')
```

### 5. Standalone checkForUpdates Removed

**What changed:** The standalone `checkForUpdates` export no longer exists. Use the composable.

**Search my codebase for:** `import { checkForUpdates }`

**Regex pattern:** `checkForUpdates.*from.*#skew`

**Before:**
```ts
import { checkForUpdates } from '#skew-protection'

checkForUpdates()
```

**After:**
```ts
const { checkForUpdates } = useSkewProtection()
checkForUpdates()
```

### 6. Cookie Defaults Changed

**What changed:** `sameSite` is now `lax` (was `strict`), `maxAge` is now 7 days (was 60 days).

**Action:** No code changes needed unless you explicitly rely on the old defaults. If you need the old behaviour, set them in config:

```ts
const config = {
  skewProtection: {
    cookie: { sameSite: 'strict', maxAge: 60 * 60 * 24 * 60 },
  },
}
```

## Verification Checklist

1. `pnpm install` (update lockfile)
2. `npx nuxi typecheck` (catch type errors)
3. `pnpm build` (catch build-time issues)
4. `pnpm test` (catch runtime regressions)
5. Test SSR page load, verify no hydration mismatch warnings

---

Please scan my codebase for all affected patterns listed above and generate a complete migration plan. For each file that needs changes, show me the exact diff.
