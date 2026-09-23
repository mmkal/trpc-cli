/**
 * Fixture for module mode with `z.function().implement(...)` exports: their input schemas are read from the
 * implemented functions at runtime (via the `_zod` property zod attaches), and only the jsdoc comments are taken
 * from source. Plain functions (`shout` below) mix in and get the usual parsed-types treatment.
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

/** shout a name (a plain function - its parameter types are parsed from source) */
export function shout(name: string, options: {times?: number}) {
  return `${name.toUpperCase()}!`.repeat(options.times || 1)
}

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

/** check a service's health endpoint */
export const checkHealth = z
  .function({
    input: [
      z
        .url()
        .refine(url => url.startsWith('https://'), 'secure only pls')
        .transform(url => url.replace(/\/$/, '')),
      z
        .object({timeout: z.number().int().positive().optional().describe('give up after this many milliseconds')})
        .optional(),
    ],
  })
  .implement((url, options) => `GET ${url}/health (timeout ${options?.timeout || 'none'})`)

/** print the version */
export const version = z.function().implement(() => '1.2.3')

export * as versions from './zod-function-versions.js'
