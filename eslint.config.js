import * as mmkal from 'eslint-plugin-mmkal'

export default [
  ...mmkal.recommendedFlatConfigs,
  {
    rules: {
      'unicorn/prefer-switch': 'off', // mmkal
      'import-x/order': 'off',
      'unicorn/no-array-sort': 'off', // mmkal (maybe make smarter - ignore if a lib, or if following a .map/.filter/.slice etc.)
    },
  },
  {ignores: ['src/zod-to-json-schema/**']},
  // {ignores: ['**/*ignoreme*']}, //
]
