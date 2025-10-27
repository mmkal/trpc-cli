import * as mmkal from 'eslint-plugin-mmkal'

export default [
  ...mmkal.recommendedFlatConfigs, //
  {ignores: ['src/zod-to-json-schema/**']},
]
