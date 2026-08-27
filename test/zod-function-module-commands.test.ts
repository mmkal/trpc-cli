/**
 * Module mode from `z.function().implement(...)` exports: when every exported function is a zod function, the
 * input schemas are read from the functions at runtime (colinhacks/zod#6104), and the source-parsing typebox
 * flow is skipped entirely.
 */
import {expect, test} from 'vitest'
import {z} from 'zod'
import {runWith, snapshotSerializer} from './test-run.js'

expect.addSnapshotSerializer(snapshotSerializer)

const modulePath = './test/fixtures/zod-function-module.ts'

test('zod function module: --help lists commands in source order with jsdoc descriptions', async () => {
  expect(await runWith({filename: modulePath, name: 'mypkg'}, ['--help'])).toMatchInlineSnapshot(`
    "Usage: mypkg [options] [command]

    Available subcommands: say-hello, add, install, version, versions

    Options:
      -h, --help                     display help for command

    Commands:
      say-hello|hi [options] <name>  greet someone
      add <left> <right>             add two numbers
      install [options]              install dependencies from the lockfile
      version [options]              print the version
      versions                       Available subcommands: list
      help [command]                 display help for command
    "
  `)
})

test('zod function module: positionals and flags come from the tuple input schema', async () => {
  expect(await runWith({filename: modulePath}, ['say-hello', '--help'])).toMatchInlineSnapshot(`
    "Usage: zod-function-module say-hello|hi [options] <name>

    greet someone

    Arguments:
      name                   who to greet (required)

    Options:
      --enthusiasm [number]  number of exclamation marks; Exclusive minimum: 0
      -h, --help             display help for command
    "
  `)
  expect(await runWith({filename: modulePath}, ['say-hello', 'bob'])).toMatchInlineSnapshot(`"Hello, bob"`)
  expect(await runWith({filename: modulePath}, ['hi', 'bob', '--enthusiasm', '3'])).toMatchInlineSnapshot(
    `"Hello, bob!!!"`,
  )
  expect(await runWith({filename: modulePath}, ['add', '2', '3'])).toMatchInlineSnapshot(`"5"`)
})

test('zod function module: validation errors come from the zod schemas', async () => {
  await expect(runWith({filename: modulePath}, ['say-hello', 'bob', '--enthusiasm', '-1'])).rejects
    .toMatchInlineSnapshot(`
      CLI exited with code 1
        Caused by: Error: Invalid input: ✖ Too small: expected number to be >0 → at [1].enthusiasm
    `)
  await expect(runWith({filename: modulePath}, ['add', 'two', '3'])).rejects.toMatchInlineSnapshot(`
    CLI exited with code 1
      Caused by: CommanderError: error: command-argument value 'two' is invalid for argument 'left'. Invalid number: two
  `)
})

test('zod function module: single object parameter becomes flags with zod descriptions and defaults', async () => {
  expect(await runWith({filename: modulePath}, ['install', '--help'])).toMatchInlineSnapshot(`
    "Usage: zod-function-module install [options]

    install dependencies from the lockfile

    Options:
      --frozen-lockfile [boolean]  fail if the lockfile is out of date
      --registry [string]          registry to install from; Format: uri (default:
                                   "https://registry.npmjs.org")
      -h, --help                   display help for command
    "
  `)
  expect(await runWith({filename: modulePath}, ['install'])).toMatchInlineSnapshot(
    `"installed from https://registry.npmjs.org"`,
  )
  expect(await runWith({filename: modulePath}, ['install', '--frozen-lockfile'])).toMatchInlineSnapshot(
    `"installed from https://registry.npmjs.org (frozen)"`,
  )
})

test('zod function module: functions with no input become no-input commands', async () => {
  expect(await runWith({filename: modulePath}, ['version'])).toMatchInlineSnapshot(`"1.2.3"`)
})

test('zod function module: re-exported modules become nested commands', async () => {
  expect(await runWith({filename: modulePath}, ['versions', 'list', '--json'])).toMatchInlineSnapshot(
    `"{"foo":"1.0.0"}"`,
  )
})

test('zod function module: {source, exports} escape hatch works with no source parsing', async () => {
  const exports = {
    greet: z.function({input: [z.string()]}).implement(name => `hi ${name}`),
  }
  expect(await runWith({source: '', exports}, ['greet', 'bob'])).toMatchInlineSnapshot(`"hi bob"`)
  expect(await runWith({source: '', exports}, ['--help'])).toMatchInlineSnapshot(`
    "Usage: program [options] [command]

    Available subcommands: greet

    Options:
      -h, --help           display help for command

    Commands:
      greet <parameter_1>
      help [command]       display help for command
    "
  `)
})

test('zod function module: mixing zod functions with plain functions is an error', async () => {
  const source = `
    export const greet = z.function({input: [z.string()]}).implement(name => 'hi ' + name)
    export function shout(name: string) { return name.toUpperCase() }
  `
  const exports = {
    greet: z.function({input: [z.string()]}).implement(name => `hi ${name}`),
    shout: (name: string) => name.toUpperCase(),
  }
  await expect(runWith({source, exports}, ['--help'])).rejects.toThrowErrorMatchingInlineSnapshot(
    `Error: Module mixes zod functions ("greet") with plain functions ("shout"). Either make every exported function a \`z.function().implement(...)\`, or move the zod functions into a separate module and re-export it.`,
  )
})

test('zod function module: rest arguments are not supported', async () => {
  const exports = {
    sum: z.function({input: z.array(z.number())}).implement((...numbers) => numbers.reduce((a, b) => a + b, 0)),
  }
  await expect(runWith({source: '', exports}, ['--help'])).rejects.toThrowErrorMatchingInlineSnapshot(
    `Error: Zod function "sum" has an array input, which isn't supported. Use a tuple input like \`z.function({input: [z.string(), z.object({...})]})\` so parameters can map to positional arguments and flags.`,
  )
})

test('zod function module: default exports are not supported', async () => {
  const exports = {
    default: z.function({input: [z.string()]}).implement(name => `hi ${name}`),
  }
  await expect(runWith({source: '', exports}, ['--help'])).rejects.toThrowErrorMatchingInlineSnapshot(
    `Error: Default-exported zod functions aren't supported - export it with a name, e.g. \`export const greet = z.function(...).implement(...)\`.`,
  )
})
