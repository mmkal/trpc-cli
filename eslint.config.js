module.exports = [
  ...require('eslint-plugin-mmkal').recommendedFlatConfigs,
  {
    rules: {
      'unicorn/prefer-switch': 'off', // mmkal
    },
  },
  {ignores: ['src/zod-to-json-schema/**']},
  // {ignores: ['**/*ignoreme*']}, //
]
