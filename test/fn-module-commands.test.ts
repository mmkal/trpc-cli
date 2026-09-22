/**
 * Module mode from `fn(...).implement(...)` exports (trpc-cli's own `z.function()`-shaped builder): schemas can be
 * any Standard Schema, positional names come from the callback's parameters, and nothing is parsed from source
 * except the export declaration (for ordering and fallback jsdoc). Mixes with plain and zod functions.
 */
import {expect, test} from 'vitest'
import {z} from 'zod'
import {fn} from '../src/index.js'
import {runWith, snapshotSerializer} from './test-run.js'

expect.addSnapshotSerializer(snapshotSerializer)

const modulePath = './test/fixtures/fn-module.ts'

test('fn module: --help lists fn, plain and zod commands in source order', async () => {
  expect(await runWith({filename: modulePath, name: 'mypkg'}, ['--help'])).toMatchInlineSnapshot(`
    "Usage: mypkg [options] [command]

    Available subcommands: say-hello, add, shout, subtract, install, version

    Options:
      -h, --help                     display help for command

    Commands:
      say-hello|hi [options] <name>  greet someone
      add <left> <right>             add two numbers (jsdoc is the fallback
                                     description when there's no \`.describe()\`)
      shout <name>                   a plain function, mixed in - its parameter
                                     types are parsed from source as usual
      subtract <left> <right>
      install [options]              install dependencies from the lockfile
      version [options]              print the version
      help [command]                 display help for command
    "
  `)
})

test('fn module: positionals are named after the callback parameters, flags come from the trailing object', async () => {
  expect(await runWith({filename: modulePath}, ['say-hello', '--help'])).toMatchInlineSnapshot(`
    "Usage: fn-module say-hello|hi [options] <name>

    greet someone

    Arguments:
      name                   who to greet (required)

    Options:
      --shout [boolean]
      --enthusiasm [number]  Exclusive minimum: 0 (default: 1)
      -h, --help             display help for command
    "
  `)
  expect(await runWith({filename: modulePath}, ['say-hello', 'bob'])).toMatchInlineSnapshot(`"Hello, bob!"`)
  expect(await runWith({filename: modulePath}, ['hi', 'bob', '--shout', '--enthusiasm', '3'])).toMatchInlineSnapshot(
    `"HELLO, BOB!!!"`,
  )
})

test('fn module: valibot schemas work too', async () => {
  expect(await runWith({filename: modulePath}, ['add', '--help'])).toMatchInlineSnapshot(`
    "Usage: fn-module add [options] <left> <right>

    add two numbers (jsdoc is the fallback description when there's no
    \`.describe()\`)

    Arguments:
      left        number (required)
      right       number (required)

    Options:
      -h, --help  display help for command
    "
  `)
  expect(await runWith({filename: modulePath}, ['add', '2', '3'])).toMatchInlineSnapshot(`"5"`)
})

test('fn module: validation errors come from the item schemas', async () => {
  await expect(runWith({filename: modulePath}, ['say-hello', 'bob', '--enthusiasm', '-1'])).rejects
    .toMatchInlineSnapshot(`
      CLI exited with code 1
        Caused by: Error: Invalid input: ✖ Too small: expected number to be >0 → at [1].enthusiasm
    `)
})

test('fn module: single object parameter becomes flags; no input becomes a no-input command', async () => {
  expect(await runWith({filename: modulePath}, ['install', '--help'])).toMatchInlineSnapshot(`
    "Usage: fn-module install [options]

    install dependencies from the lockfile

    Options:
      --frozen-lockfile [boolean]  fail if the lockfile is out of date
      --registry [string]          registry to install from; Format: uri (default:
                                   "https://registry.npmjs.org")
      -h, --help                   display help for command
    "
  `)
  expect(await runWith({filename: modulePath}, ['install', '--frozen-lockfile'])).toMatchInlineSnapshot(
    `"installed from https://registry.npmjs.org (frozen)"`,
  )
  expect(await runWith({filename: modulePath}, ['version'])).toMatchInlineSnapshot(`"1.2.3"`)
})

test('fn module: plain and zod functions mix in', async () => {
  expect(await runWith({filename: modulePath}, ['shout', 'bob'])).toMatchInlineSnapshot(`"BOB"`)
  expect(await runWith({filename: modulePath}, ['subtract', '5', '3'])).toMatchInlineSnapshot(`"2"`)
})

test('fn: calling the implemented function directly validates its arguments and result', async () => {
  const {sayHello, add} = await import('./fixtures/fn-module.js')
  expect(sayHello('bob')).toMatchInlineSnapshot(`"Hello, bob!"`)
  expect(() => sayHello('bob', {enthusiasm: -1})).toThrowErrorMatchingInlineSnapshot(
    `StandardSchemaV1Error: ✖ Too small: expected number to be >0 → at [1].enthusiasm`,
  )
  expect(add(2, 3)).toBe(5)
  // @ts-expect-error - wrong argument type, caught at runtime too
  expect(() => add('2', 3)).toThrowErrorMatchingInlineSnapshot(
    `StandardSchemaV1Error: ✖ Invalid type: Expected number but received "2" → at [0]`,
  )
})

test('fn module: a default export becomes the default command', async () => {
  const source = `export default fn({input: [z.object({name: z.string()})]}).implement(options => 'hi ' + options.name)`
  const exports = {
    default: fn({input: [z.object({name: z.string()})]}).implement(options => `hi ${options.name}`),
  }
  expect(await runWith({source, exports}, ['--name', 'bob'])).toMatchInlineSnapshot(`"hi bob"`)
})

test('fn module: {source, exports} escape hatch only needs the export declaration in source', async () => {
  const source = `
    /** @alias g */
    export const greet = fn({input: [z.string()]}).implement(name => 'hi ' + name)
  `
  const exports = {
    greet: fn({input: [z.string()]})
      .describe('greet someone')
      .implement(name => `hi ${name}`),
  }
  expect(await runWith({source, exports}, ['--help'])).toMatchInlineSnapshot(`
    "Usage: program [options] [command]

    Available subcommands: greet

    Options:
      -h, --help      display help for command

    Commands:
      greet|g <name>  greet someone
      help [command]  display help for command
    "
  `)
  expect(await runWith({source, exports}, ['g', 'bob'])).toMatchInlineSnapshot(`"hi bob"`)
})
