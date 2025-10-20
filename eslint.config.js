import mmkal from 'eslint-plugin-mmkal'

export default [
  ...mmkal.recommendedFlatConfigs,
  {
    rules: {
      'unicorn/prefer-switch': 'off', // mmkal
      'import-x/order': 'off',
    },
  },
  {ignores: ['src/zod-to-json-schema/**']},
  // {ignores: ['**/*ignoreme*']}, //
]
