/**
 * The experimental `createCli({module: ...})` feature: derive a CLI from a plain TypeScript module of exported
 * functions. Note what ISN'T imported by the fixture (test/fixtures/commands-module.ts): no zod, no @trpc/server,
 * no router - jsdoc comments and parameter type annotations in the source text drive descriptions and validation.
 */
import * as fs from 'fs'
import {expect, test} from 'vitest'
import {createCli} from '../src/index.js'
import * as commandsModule from './fixtures/commands-module.js'
import {runWith, snapshotSerializer} from './test-run.js'

expect.addSnapshotSerializer(snapshotSerializer)

const modulePath = './test/fixtures/commands-module.ts' // resolved against process.cwd(), which vitest sets to the repo root

test('module commands: --help lists commands with jsdoc descriptions', async () => {
  const help = await runWith({module: modulePath, name: 'mypkg'}, ['--help'])
  expect(help).toMatchInlineSnapshot(`
    "Usage: mypkg [options] [command]

    Available subcommands: install, add, list-versions

    Options:
      -h, --help               display help for command

    Commands:
      install [options]        install dependencies from the lockfile
      add [options]            add a package to the dependencies
      list-versions [options]  print versions of all installed packages
      help [command]           display help for command
    "
  `)
})

test('module commands: property jsdoc shows up as flag descriptions', async () => {
  const installHelp = await runWith({module: modulePath}, ['install', '--help'])
  expect(installHelp).toContain('--frozen-lockfile')
  expect(installHelp).toContain('fail if the lockfile is out of date')

  // `add` uses a named type (`AddOptions`) declared in the same file rather than an inline literal
  const addHelp = await runWith({module: modulePath}, ['add', '--help'])
  expect(addHelp).toContain('--package-name <string>')
  expect(addHelp).toContain('the name of the package to add')
  expect(addHelp).toContain('add to devDependencies instead of dependencies')
})

test('module commands: commands execute with flags and return values get logged', async () => {
  expect(await runWith({module: modulePath}, ['install'])).toMatchInlineSnapshot(`"installed dependencies"`)
  expect(await runWith({module: modulePath}, ['install', '--frozen-lockfile'])).toMatchInlineSnapshot(
    `"installed dependencies (frozen lockfile)"`,
  )
  expect(await runWith({module: modulePath}, ['add', '--package-name', 'left-pad', '--dev'])).toMatchInlineSnapshot(`
    "{
      "added": "left-pad",
      "dev": true
    }"
  `)
  expect(await runWith({module: modulePath}, ['list-versions'])).toMatchInlineSnapshot(`
    "{
      "left-pad": "1.3.0",
      "is-odd": "3.0.1"
    }"
  `)
})

test('module commands: inputs are validated against the schema before the function runs', async () => {
  await expect(runWith({module: modulePath}, ['add'])).rejects.toMatchInlineSnapshot(`
    CLI exited with code 1
      Caused by: CommanderError: error: required option '--package-name <string>' not specified
  `)
  await expect(runWith({module: modulePath}, ['install', '--frozen-lockfile', 'maybe'])).rejects.toMatchInlineSnapshot(
    `
      CLI exited with code 1
        Caused by: Error: Invalid input: ✖ must be boolean → at frozenLockfile
    `,
  )
})

test('module commands: missing module file errors clearly', async () => {
  await expect(runWith({module: './nope/does-not-exist.ts'}, ['--help'])).rejects.toThrowError(
    /Could not read module source at .*does-not-exist\.ts/,
  )
})

test('module commands: {source, exports} escape hatch works without file reading', async () => {
  const params = {
    module: {
      source: fs.readFileSync(modulePath, 'utf8'),
      exports: {...commandsModule},
    },
  }
  expect(await runWith(params, ['install', '--frozen-lockfile'])).toMatchInlineSnapshot(
    `"installed dependencies (frozen lockfile)"`,
  )
  expect(await runWith(params, ['add', '--help'])).toContain('the name of the package to add')
})

test('module commands: non-object first parameter errors clearly', async () => {
  const params = {
    module: {
      source: `export function double(n: number) { return n * 2 }`,
      exports: {double: (n: number) => n * 2},
    },
  }
  await expect(runWith(params, ['--help'])).rejects.toThrowError(
    'The first parameter of "double" must be an object type, got `number`. Non-object parameters aren\'t supported yet - wrap the value in an object, e.g. `{value: number}`.',
  )
})

test('module commands: missing type annotation errors clearly', async () => {
  const params = {
    module: {
      source: `export function greet(name) { return 'hi ' + name }`,
      exports: {greet: (name: string) => 'hi ' + name},
    },
  }
  await expect(runWith(params, ['--help'])).rejects.toThrowError(
    'The first parameter of "greet" has no type annotation. Annotate it with an object type, e.g. `(name: {someFlag: string})`.',
  )
})

test('module commands: unresolvable named type errors clearly', async () => {
  const params = {
    module: {
      source: `export function deploy(options: ImportedFromElsewhere) {}`,
      exports: {deploy: () => {}},
    },
  }
  await expect(runWith(params, ['--help'])).rejects.toThrowError(
    'The parameter type for "deploy" references "ImportedFromElsewhere", which couldn\'t be resolved. Declare it as `type X = {...}` or `interface X {...}` in the same file, or inline the object type literal.',
  )
})

test('module commands: exported function with no parseable declaration errors clearly', async () => {
  const params = {
    module: {
      // `export {fn}` statements aren't supported by the extractor - the error should say so
      source: `const start = () => 'started'\nexport {start}`,
      exports: {start: () => 'started'},
    },
  }
  await expect(runWith(params, ['--help'])).rejects.toThrowError(
    /Could not find a parseable declaration for exported function\(s\) "start"/,
  )
})

test('module commands: module with no functions errors clearly', async () => {
  const params = {
    module: {
      source: `export const VERSION = '1.0.0'`,
      exports: {VERSION: '1.0.0'},
    },
  }
  await expect(runWith(params, ['--help'])).rejects.toThrowError(/No commands found in module/)
})

test('module commands: buildProgram and toJSON are not supported (yet)', async () => {
  const cli = createCli({module: modulePath})
  expect(() => cli.buildProgram()).toThrowError(/buildProgram is not supported when using `module`/)
  expect(() => cli.toJSON()).toThrowError(/toJSON is not supported when using `module`/)
})
