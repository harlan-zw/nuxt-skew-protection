import { defineBuildConfig } from 'unbuild'

// This config is read by nuxt-module-build (which uses unbuild internally)
// We set failOnWarn: false because adapters are built in a separate step
export default defineBuildConfig({
  failOnWarn: false,
})
