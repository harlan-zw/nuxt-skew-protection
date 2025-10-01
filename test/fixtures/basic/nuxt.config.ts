export default defineNuxtConfig({
  modules: ['../../../src/module'],
  skewProtection: {
    debug: true,
    storage: {
      driver: 'memory',
    },
    retentionDays: 1,
    maxNumberOfVersions: 3,
    enableDeploymentMapping: true,
  },
})
