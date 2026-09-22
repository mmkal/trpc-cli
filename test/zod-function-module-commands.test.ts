/**
 * Module mode from `z.function().implement(...)` exports: their input schemas are read from the functions at
 * runtime (colinhacks/zod#6104) instead of being parsed from source. They mix freely with plain exported functions.
 */
import {expect, test} from 'vitest'
import {z} from 'zod'
import {runWith, snapshotSerializer} from './test-run.js'

expect.addSnapshotSerializer(snapshotSerializer)

const modulePath = './test/fixtures/zod-function-module.ts'

test('zod function module: --help lists commands in source order with jsdoc descriptions', async () => {
  expect(await runWith({filename: modulePath, name: 'mypkg'}, ['--help'])).toMatchInlineSnapshot(`
    "Usage: mypkg [options] [command]

    Available subcommands: say-hello, add, shout, install, version, versions

    Options:
      -h, --help                     display help for command

    Commands:
      say-hello|hi [options] <name>  greet someone
      add <left> <right>             add two numbers
      shout [options] <name>         shout a name (a plain function - its parameter
                                     types are parsed from source)
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

test('zod function module: {source, exports} escape hatch only needs the export declaration in source', async () => {
  const source = `export const greet = z.function({input: [z.string()]}).implement(name => 'hi ' + name)`
  const exports = {
    greet: z.function({input: [z.string()]}).implement(name => `hi ${name}`),
  }
  expect(await runWith({source, exports}, ['greet', 'bob'])).toMatchInlineSnapshot(`"hi bob"`)
  expect(await runWith({source, exports}, ['--help'])).toMatchInlineSnapshot(`
    "Usage: program [options] [command]

    Available subcommands: greet

    Options:
      -h, --help      display help for command

    Commands:
      greet <name>
      help [command]  display help for command
    "
  `)
})

test('zod function module: positionals are named after the .implement() callback parameters', async () => {
  const source = `
    export const sayHello = z
      .function({input: [z.string(), z.object({shout: z.boolean(), enthusiasm: z.number()})]})
      .implement((name, options) => name)
  `
  const exports = {
    sayHello: z
      .function({input: [z.string(), z.object({shout: z.boolean(), enthusiasm: z.number()})]})
      .implement((name, options) => `${options.shout ? name.toUpperCase() : name}${'!'.repeat(options.enthusiasm)}`),
  }
  expect(await runWith({source, exports}, ['say-hello', '--help'])).toMatchInlineSnapshot(`
    "Usage: program say-hello [options] <name>

    Arguments:
      name                   (required)

    Options:
      --shout [boolean]      (default: false)
      --enthusiasm <number>
      -h, --help             display help for command
    "
  `)
  expect(await runWith({source, exports}, ['say-hello', 'bob', '--shout', '--enthusiasm', '2'])).toMatchInlineSnapshot(
    `"BOB!!"`,
  )
})

test('zod function module: @param tags document positionals named after the .implement() callback parameters', async () => {
  const source = `
    /**
     * greet someone
     * @param name who to greet
     * @param options.shout this loses to the schema's own .describe()
     * @param options.enthusiasm how many exclamation marks to add
     * @returns the greeting
     */
    export const sayHello = z
      .function({input: [z.string(), z.object({shout: z.boolean().describe('SHOUT'), enthusiasm: z.number()})]})
      .implement((name, options) => name)
  `
  const exports = {
    sayHello: z
      .function({input: [z.string(), z.object({shout: z.boolean().describe('SHOUT'), enthusiasm: z.number()})]})
      .implement((name, options) => `${options.shout ? name.toUpperCase() : name}${'!'.repeat(options.enthusiasm)}`),
  }
  expect(await runWith({source, exports}, ['say-hello', '--help'])).toMatchInlineSnapshot(`
    "Usage: program say-hello [options] <name>

    greet someone

    Arguments:
      name                   who to greet (required)

    Options:
      --shout [boolean]      SHOUT (default: false)
      --enthusiasm <number>  how many exclamation marks to add
      -h, --help             display help for command
    "
  `)
})

test('zod function module: export names containing $ still get their jsdoc description', async () => {
  const source = `
    /** greet with a dollar */
    export const $greet = z.function({input: [z.string()]}).implement(name => 'hi ' + name)
  `
  const exports = {
    $greet: z.function({input: [z.string()]}).implement(name => `hi ${name}`),
  }
  expect(await runWith({source, exports}, ['--help'])).toMatchInlineSnapshot(`
    "Usage: program [options] [command]

    Available subcommands: $greet

    Options:
      -h, --help      display help for command

    Commands:
      $greet <name>   greet with a dollar
      help [command]  display help for command
    "
  `)
})

test('zod function module: plain functions mix in, with their types parsed from source', async () => {
  expect(await runWith({filename: modulePath}, ['shout', '--help'])).toMatchInlineSnapshot(`
    "Usage: zod-function-module shout [options] <name>

    shout a name (a plain function - its parameter types are parsed from source)

    Arguments:
      name              (required)

    Options:
      --times [number]
      -h, --help        display help for command
    "
  `)
  expect(await runWith({filename: modulePath}, ['shout', 'bob', '--times', '2'])).toMatchInlineSnapshot(`"BOB!BOB!"`)
})

test('zod function module: rest arguments are not supported', async () => {
  const source = `export const sum = z.function({input: z.array(z.number())}).implement((...numbers) => 0)`
  const exports = {
    sum: z.function({input: z.array(z.number())}).implement((...numbers) => numbers.reduce((a, b) => a + b, 0)),
  }
  await expect(runWith({source, exports}, ['--help'])).rejects.toThrowErrorMatchingInlineSnapshot(
    `Error: Zod function "sum" has an array input, which isn't supported. Use a tuple input like \`z.function({input: [z.string(), z.object({...})]})\` so parameters can map to positional arguments and flags.`,
  )
})

test('zod function module: a default export becomes the default command', async () => {
  const source = `
    /** greet whoever */
    export default z.function({input: [z.object({name: z.string()})]}).implement(options => 'hi ' + options.name)
  `
  const exports = {
    default: z.function({input: [z.object({name: z.string()})]}).implement(options => `hi ${options.name}`),
  }
  expect(await runWith({source, exports}, ['--name', 'bob'])).toMatchInlineSnapshot(`"hi bob"`)
  expect(await runWith({source, exports}, ['--help'])).toMatchInlineSnapshot(`
    "Usage: program [options] [command]

    Available subcommands: default (default)

    Options:
      -h, --help         display help for command

    Commands:
      default [options]  greet whoever
    "
  `)
})
