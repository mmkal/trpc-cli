/**
 * Fixture for module mode with `fn(...).implement(...)` exports: schemas are any Standard Schema (zod and valibot
 * here), positional names come from the callback's parameters, and descriptions from `.describe()`/`.meta()` (the
 * jsdoc above an export is only a fallback). Plain functions and zod functions mix in.
 */
import * as v from 'valibot'
import {z} from 'zod'
import {fn} from '../../src/index.js'

export const sayHello = fn({
  input: [
    z.string().describe('who to greet'),
    z.object({shout: z.boolean().optional(), enthusiasm: z.number().int().positive().default(1)}).optional(),
  ],
})
  .describe('greet someone')
  .meta({aliases: {command: ['hi']}})
  .implement((name, options) => {
    const greeting = `Hello, ${name}` + '!'.repeat(options?.enthusiasm || 1)
    return options?.shout ? greeting.toUpperCase() : greeting
  })

/** add two numbers (jsdoc is the fallback description when there's no `.describe()`) */
export const add = fn({input: [v.number(), v.number()], output: v.number()}).implement((left, right) => left + right)

/** a plain function, mixed in - its parameter types are parsed from source as usual */
export function shout(name: string) {
  return name.toUpperCase()
}

export const subtract = z.function({input: [z.number(), z.number()]}).implement((left, right) => left - right) // zod functions mix in too

export const install = fn({
  input: [
    z.object({
      frozenLockfile: z.boolean().optional().describe('fail if the lockfile is out of date'),
      registry: z.string().url().default('https://registry.npmjs.org').describe('registry to install from'),
    }),
  ],
})
  .describe('install dependencies from the lockfile')
  .implement(async options => `installed from ${options.registry}${options.frozenLockfile ? ' (frozen)' : ''}`)

export const version = fn()
  .describe('print the version')
  .implement(() => '1.2.3')
