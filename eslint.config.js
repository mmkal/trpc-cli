module.exports = [
  ...require('eslint-plugin-mmkal').recommendedFlatConfigs,
  {
    rules: {
      'unicorn/prefer-switch': 'off', // mmkal
      'import-x/order': 'off',
    },
  },
  {ignores: ['src/zod-to-json-schema/**']},
  // {ignores: ['**/*ignoreme*']}, //
]
