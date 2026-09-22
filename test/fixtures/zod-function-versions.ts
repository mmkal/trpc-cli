import {z} from 'zod'

/** list installed versions */
export const list = z
  .function({input: [z.object({json: z.boolean().optional()})]})
  .implement(options => (options.json ? JSON.stringify({foo: '1.0.0'}) : 'foo@1.0.0'))
