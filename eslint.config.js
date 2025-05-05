module.exports = [
  ...require('eslint-plugin-mmkal').recommendedFlatConfigs,
  {
    rules: {
      'unicorn/prefer-switch': 'off', // mmkal
    }
  },
  {ignores: ['**/*ignoreme*']}, //
]
