import antfu from '@antfu/eslint-config'
import harlanzw from 'eslint-plugin-harlanzw'

export default antfu({
  // This repo lints `test/fixtures/**` on purpose, so the shared ignore set is
  // off and the repo keeps its own list. A global ignore cannot be undone.
  ignores: [
    '.eslintignore',
    'test/fixtures/*/node_modules',
    'test/fixtures/*/.nuxt',
    'test/fixtures/*/.output',
    'test/fixtures/*/.skew-storage',
  ],
  rules: {
    'unused-imports/no-unused-vars': ['error', {
      argsIgnorePattern: '^_',
      varsIgnorePattern: '^_',
      caughtErrorsIgnorePattern: '^_',
    }],
  },
}, {
  files: ['test/**/*.ts', 'scripts/**/*.ts', 'playground/**/*.vue'],
  rules: {
    'no-console': 'off',
    'no-restricted-globals': 'off',
    'ts/no-namespace': 'off',
    'ts/method-signature-style': 'off',
    'vue/no-unused-vars': 'off',
  },
}, {
  files: ['**/*.md', '**/*.md/**'],
  rules: {
    'unused-imports/no-unused-vars': 'off',
    'ts/no-unused-vars': 'off',
  },
}, ...harlanzw({ base: { ignores: false }, link: true, nuxt: true, vue: true }), {
  files: ['test/fixtures/**/*.vue'],
  rules: {
    'harlanzw/nuxt-no-unsafe-date': 'off',
  },
})
