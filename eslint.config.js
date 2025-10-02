import antfu from '@antfu/eslint-config'

export default antfu({
  ignores: [
    '.eslintignore',
    'test/fixtures/*/node_modules',
    'test/fixtures/*/.nuxt',
    'test/fixtures/*/.output',
    'test/fixtures/*/.skew-storage',
  ],
  rules: {
    'node/prefer-global/process': 'off',
    'node/prefer-global/buffer': 'off',
    'no-use-before-define': 'off',
    'ts/no-use-before-define': 'off',
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
})
