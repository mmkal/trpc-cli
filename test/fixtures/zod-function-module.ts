/**
 * Fixture for module mode driven by `z.function().implement(...)` exports: the input schemas are read from
 * the implemented functions at runtime (via the `_zod` property zod attaches), so nothing here is parsed from
 * source except the jsdoc comments used for command descriptions.
 */
import {z} from 'zod'

/**
 * greet someone
 * @alias hi
 */
export const sayHello = z
  .function({
    input: [
      z.string().meta({title: 'name', description: 'who to greet'}),
      z.object({enthusiasm: z.number().int().positive().describe('number of exclamation marks')}).optional(),
    ],
  })
  .implement((name, options) => {
    let greeting = `Hello, ${name}`
    if (options?.enthusiasm) greeting += '!'.repeat(options.enthusiasm)
    return greeting
  })

/** add two numbers */
export const add = z
  .function({input: [z.number().describe('left'), z.number().describe('right')], output: z.number()})
  .implement((left, right) => left + right)

/** install dependencies from the lockfile */
export const install = z
  .function({
    input: [
      z.object({
        /** this jsdoc is NOT used - zod `.describe()` is the source of flag descriptions */
        frozenLockfile: z.boolean().optional().describe('fail if the lockfile is out of date'),
        registry: z.string().url().default('https://registry.npmjs.org').describe('registry to install from'),
      }),
    ],
  })
  .implement(async options => `installed from ${options.registry}${options.frozenLockfile ? ' (frozen)' : ''}`)

/** print the version */
export const version = z.function().implement(() => '1.2.3')

export * as versions from './zod-function-versions.js'
