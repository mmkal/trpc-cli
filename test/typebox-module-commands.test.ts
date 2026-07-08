/**
 * The experimental `createCli({filename: ...})` feature: derive a CLI from a plain TypeScript module of exported
 * functions. Note what ISN'T imported by the fixture (test/fixtures/commands-module.ts): no zod, no @trpc/server,
 * no router - jsdoc comments and parameter type annotations in the source text drive descriptions and validation.
 */
import {execa} from 'execa'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {fileURLToPath} from 'url'
import {expect, test} from 'vitest'
import {createCli} from '../src/index.js'
import * as commandsModule from './fixtures/commands-module.js'
import {runWith, snapshotSerializer} from './test-run.js'

expect.addSnapshotSerializer(snapshotSerializer)

const modulePath = './test/fixtures/commands-module.ts' // resolved against process.cwd(), which vitest sets to the repo root

test('module commands: --help lists commands with jsdoc descriptions', async () => {
  const help = await runWith({filename: modulePath, name: 'mypkg'}, ['--help'])
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
  const installHelp = await runWith({filename: modulePath}, ['install', '--help'])
  expect(installHelp).toContain('--frozen-lockfile')
  expect(installHelp).toContain('fail if the lockfile is out of date')

  // `add` uses a named type (`AddOptions`) declared in the same file rather than an inline literal
  const addHelp = await runWith({filename: modulePath}, ['add', '--help'])
  expect(addHelp).toContain('--package-name <string>')
  expect(addHelp).toContain('the name of the package to add')
  expect(addHelp).toContain('add to devDependencies instead of dependencies')
})

test('module commands: commands execute with flags and return values get logged', async () => {
  expect(await runWith({filename: modulePath}, ['install'])).toMatchInlineSnapshot(`"installed dependencies"`)
  expect(await runWith({filename: modulePath}, ['install', '--frozen-lockfile'])).toMatchInlineSnapshot(
    `"installed dependencies (frozen lockfile)"`,
  )
  expect(await runWith({filename: modulePath}, ['add', '--package-name', 'left-pad', '--dev'])).toMatchInlineSnapshot(`
    "{
      "added": "left-pad",
      "dev": true
    }"
  `)
  expect(await runWith({filename: modulePath}, ['list-versions'])).toMatchInlineSnapshot(`
    "{
      "left-pad": "1.3.0",
      "is-odd": "3.0.1"
    }"
  `)
})

test('module commands: inputs are validated against the schema before the function runs', async () => {
  await expect(runWith({filename: modulePath}, ['add'])).rejects.toMatchInlineSnapshot(`
    CLI exited with code 1
      Caused by: CommanderError: error: required option '--package-name <string>' not specified
  `)
  await expect(
    runWith({filename: modulePath}, ['install', '--frozen-lockfile', 'maybe']),
  ).rejects.toMatchInlineSnapshot(
    `
      CLI exited with code 1
        Caused by: Error: Invalid input: ✖ must be boolean → at frozenLockfile
    `,
  )
})

test('module commands: URL module input resolves relative to the referencing file', async () => {
  const moduleUrl = new URL('fixtures/commands-module.ts', import.meta.url)
  expect(await runWith({filename: moduleUrl}, ['install', '--frozen-lockfile'])).toMatchInlineSnapshot(
    `"installed dependencies (frozen lockfile)"`,
  )
  expect(await runWith({filename: moduleUrl}, ['add', '--help'])).toContain('the name of the package to add')
})

test('module commands: URL module form keeps working when the CLI runs from an unrelated cwd', async () => {
  // a distributed CLI (e.g. installed globally) can be invoked from anywhere - the fixture CLI uses
  // `new URL('./commands-module.ts', import.meta.url)` so the module resolves against the CLI file, not the cwd.
  // a cwd-relative string like './test/fixtures/commands-module.ts' would fail with "Could not read module source" here.
  const repoRoot = fileURLToPath(new URL('..', import.meta.url))
  const {all} = await execa(
    path.join(repoRoot, 'node_modules/.bin/tsx'),
    [path.join(repoRoot, 'test/fixtures/commands-module-cli.ts'), 'install', '--frozen-lockfile'],
    {all: true, cwd: os.tmpdir()},
  )
  expect(all).toContain('installed dependencies (frozen lockfile)')
})

test('module commands: an import.meta-shaped object resolves via filename', async () => {
  // import.meta is `{url, filename, dirname, resolve}` on modern runtimes - createCli(import.meta) reads filename
  const importMetaLike = {
    filename: fileURLToPath(new URL('fixtures/commands-module.ts', import.meta.url)),
    url: 'unused',
  }
  expect(await runWith(importMetaLike, ['install', '--frozen-lockfile'])).toMatchInlineSnapshot(
    `"installed dependencies (frozen lockfile)"`,
  )
})

test('module commands: falls back to url when filename is absent (e.g. node 18, non-node runtimes)', async () => {
  // older Node populates import.meta.url but not import.meta.filename - the url fallback keeps createCli(import.meta) working
  const urlOnly = {url: new URL('fixtures/commands-module.ts', import.meta.url).href}
  expect(await runWith(urlOnly, ['install'])).toMatchInlineSnapshot(`"installed dependencies"`)
})

test('module commands: createCli(import.meta).run() works as a self-contained single file (e2e)', async () => {
  // the headline pattern - a file that defines commands and turns itself into a CLI via a self-import. Run via the
  // real bin/tsx so it exercises the actual dynamic self-import, not an in-process shortcut.
  const repoRoot = fileURLToPath(new URL('..', import.meta.url))
  const {all} = await execa(
    path.join(repoRoot, 'node_modules/.bin/tsx'),
    [path.join(repoRoot, 'test/fixtures/self-cli.ts'), 'add', '2', '3'],
    {all: true},
  )
  expect(all.trim()).toBe('5')
})

test('module commands: importing a self-contained CLI module does not run it', async () => {
  const repoRoot = fileURLToPath(new URL('..', import.meta.url))
  const {all} = await execa(
    path.join(repoRoot, 'node_modules/.bin/tsx'),
    [path.join(repoRoot, 'test/fixtures/self-cli-importer.ts')],
    {all: true},
  )
  expect(all.trim()).toBe('importer survived')
})

test('module commands: missing module file errors clearly', async () => {
  await expect(runWith({filename: './nope/does-not-exist.ts'}, ['--help'])).rejects.toThrowError(
    /Could not read module source at .*does-not-exist\.ts/,
  )
})

test('module commands: {source, exports} escape hatch works without file reading', async () => {
  const params = {
    source: fs.readFileSync(modulePath, 'utf8'),
    exports: {...commandsModule},
  }
  expect(await runWith(params, ['install', '--frozen-lockfile'])).toMatchInlineSnapshot(
    `"installed dependencies (frozen lockfile)"`,
  )
  expect(await runWith(params, ['add', '--help'])).toContain('the name of the package to add')
})

test('module commands: unparseable exported functions are ignored', async () => {
  const params = {
    source: `
      export function missingAnnotation(name) {
        return 'hi ' + name
      }

      export function unresolved(options: ImportedFromElsewhere) {
        return options.name
      }

      const localExportList = () => 'local'
      export {localExportList}

      export const loadSomeInternalThing = (params: NoInfer<{foo: string}>) => {
        return params.foo
      }

      export function status() {
        return 'ok'
      }
    `,
    exports: {
      loadSomeInternalThing: (input: any) => input.foo,
      localExportList: () => 'local',
      missingAnnotation: (name: string) => 'hi ' + name,
      status: () => 'ok',
      unresolved: (options: any) => options.name,
    },
  }

  const help = await runWith(params, ['--help'])
  expect(help).toContain('status')
  expect(help).not.toContain('missing-annotation')
  expect(help).not.toContain('unresolved')
  expect(help).not.toContain('local-export-list')
  expect(help).not.toContain('load-some-internal-thing')
  expect(await runWith(params, ['status'])).toMatchInlineSnapshot(`"ok"`)
})

test('module commands: module with only ignored function exports errors with no commands found', async () => {
  const params = {
    source: `
      export function greet(name) {
        return 'hi ' + name
      }

      export const loadSomeInternalThing = (params: NoInfer<{foo: string}>) => {
        return params.foo
      }
    `,
    exports: {greet: (name: string) => 'hi ' + name, loadSomeInternalThing: (input: any) => input.foo},
  }
  await expect(runWith(params, ['--help'])).rejects.toThrowError(/No commands found in module/)
})

test('module commands: export * merges child module commands at the root', async () => {
  using fixture = createReexportFixture()
  const params = {filename: fixture.barrelPath}

  expect(await runWith(params, ['root-thing', '--value', 'abc'])).toMatchInlineSnapshot(`"root abc"`)
  expect(await runWith(params, ['root-arrow', '--flag'])).toMatchInlineSnapshot(`"arrow on"`)
  expect(await runWith(params, ['local-thing', '--name', 'Ada'])).toMatchInlineSnapshot(`"local Ada"`)

  const help = await runWith(params, ['--help'])
  expect(help).toContain('root-thing')
  expect(help).toContain('root-arrow')
  expect(help).not.toContain('hidden-default')
})

test('module commands: export * as namespace builds a nested sub-router', async () => {
  using fixture = createReexportFixture()
  const params = {filename: fixture.barrelPath}

  expect(await runWith(params, ['admin', 'invite', '--email', 'ada@example.com'])).toMatchInlineSnapshot(`
    "invite ada@example.com"
  `)
  expect(await runWith(params, ['admin', '--user', 'Ada'])).toMatchInlineSnapshot(`"dashboard Ada"`)
  expect(await runWith(params, ['admin', 'dashboard', '--user', 'Ada'])).toMatchInlineSnapshot(`"dashboard Ada"`)

  const rootHelp = await runWith(params, ['--help'])
  expect(rootHelp).toContain('admin')
})

test('module commands: re-exported module resolution supports exact well-known extensions', async () => {
  using fixture = createReexportFixture()

  expect(await runWith({filename: fixture.barrelPath}, ['extra', 'ping', '--name', 'Ada'])).toMatchInlineSnapshot(
    `"pong Ada"`,
  )
})

test('module commands: named re-exports expose selected child command classes', async () => {
  using fixture = createReexportFixture()

  expect(await runWith({filename: fixture.barrelPath}, ['users', 'invite', '--email', 'ada@example.com']))
    .toMatchInlineSnapshot(`
      "user ada@example.com"
    `)

  const help = await runWith({filename: fixture.barrelPath}, ['--help'])
  expect(help).toContain('users')
})

test('module commands: file-backed modules resolve parameter types imported from relative files', async () => {
  using fixture = createImportedTypesFixture()

  expect(await runWith({filename: fixture.commandsPath}, ['invite', '--email', 'ada@example.com', '--role', 'admin']))
    .toMatchInlineSnapshot(`
      "invite ada@example.com as admin"
    `)
  expect(await runWith({filename: fixture.commandsPath}, ['assign', '--id', 'u_123', '--group', 'staff']))
    .toMatchInlineSnapshot(`
      "assign u_123 to staff"
    `)

  const help = await runWith({filename: fixture.commandsPath}, ['invite', '--help'])
  expect(help).toContain('email to invite')
  expect(help).toContain('role to grant')
})

test('module commands: {source, exports} rejects re-export module composition', async () => {
  const params = {
    source: `
      export * from './util.js'
      export function greet(options: {name: string}) { return 'hi ' + options.name }
    `,
    exports: {greet: (options: any) => 'hi ' + options.name, helperNotACommand: () => 'not a command'},
  }
  await expect(runWith(params, ['--help'])).rejects.toThrowError(
    /Re-exported command modules are only supported with file-backed module mode/,
  )
})

test('module commands: module with no functions errors clearly', async () => {
  const params = {
    source: `export const VERSION = '1.0.0'`,
    exports: {VERSION: '1.0.0'},
  }
  await expect(runWith(params, ['--help'])).rejects.toThrowError(/No commands found in module/)
})

test('module commands: default export becomes the default command', async () => {
  const params = {
    source: `
      /** send a greeting */
      export default function hola(options: {foo: string}) {
        return 'this is a message ' + options.foo
      }
    `,
    exports: {default: (options: any) => 'this is a message ' + options.foo},
  }
  expect(await runWith(params, ['--foo', 'abc'])).toMatchInlineSnapshot(`"this is a message abc"`)
  expect(await runWith(params, ['hola', '--foo', 'abc'])).toMatchInlineSnapshot(`"this is a message abc"`)
  expect(await runWith(params, ['--help'])).toContain('hola')
})

test('module commands: anonymous default export becomes the default command', async () => {
  const params = {
    source: `export default function (options: {foo: string}) { return options.foo }`,
    exports: {default: (options: any) => options.foo},
  }
  expect(await runWith(params, ['--foo', 'abc'])).toMatchInlineSnapshot(`"abc"`)
})

test('module commands: default export can coexist with named commands', async () => {
  const params = {
    source: `
      export default function hola(options: {foo: string}) {
        return 'default ' + options.foo
      }

      export function named(options: {bar: string}) {
        return 'named ' + options.bar
      }
    `,
    exports: {
      default: (options: any) => 'default ' + options.foo,
      named: (options: any) => 'named ' + options.bar,
    },
  }
  expect(await runWith(params, ['--foo', 'abc'])).toMatchInlineSnapshot(`"default abc"`)
  expect(await runWith(params, ['named', '--bar', 'xyz'])).toMatchInlineSnapshot(`"named xyz"`)
  expect(await runWith(params, ['--help'])).toContain('named')
})

test('module commands: default-export-only module with non-function export still errors clearly', async () => {
  const params = {
    source: `export default 'not a command'`,
    exports: {default: 'not a command'},
  }
  await expect(runWith(params, ['--help'])).rejects.toThrowError(/No commands found in module.*Export functions with/s)
})

test('module commands: buildProgram and toJSON are async (module loading is async)', async () => {
  const cli = createCli({filename: modulePath})

  const program = await cli.buildProgram()
  expect(program.commands?.map(c => c.name())).toEqual(expect.arrayContaining(['install', 'add', 'list-versions']))

  const json = await cli.toJSON()
  expect(json.commands?.map(c => c.name)).toEqual(expect.arrayContaining(['install', 'add', 'list-versions']))
})

// multi-parameter functions: leading scalar params -> positional arguments, trailing object param -> flags.
// fixture: test/fixtures/positional-commands-module.ts

const positionalModulePath = './test/fixtures/positional-commands-module.ts'

test('module positionals: scalar parameters show up as positional arguments in help', async () => {
  const addHelp = await runWith({filename: positionalModulePath, name: 'mypkg'}, ['add', '--help'])
  expect(addHelp).toMatchInlineSnapshot(`
    "Usage: mypkg add [options] <left> <right>

    add two numbers

    Arguments:
      left        number (required)
      right       number (required)

    Options:
      -h, --help  display help for command
    "
  `)

  // copy has a required positional, an optional positional with inline jsdoc, and a named-type options param
  const copyHelp = await runWith({filename: positionalModulePath, name: 'mypkg'}, ['copy', '--help'])
  expect(copyHelp).toMatchInlineSnapshot(`
    "Usage: mypkg copy [options] <source> [dest]

    copy a file

    Arguments:
      source             the file to copy (required)
      dest               where to copy it (defaults to \`<source>.bak\`)

    Options:
      --force [boolean]  overwrite the destination if it exists
      -h, --help         display help for command
    "
  `)

  // camelCase parameter names are kebab-cased for display
  const doubleHelp = await runWith({filename: positionalModulePath, name: 'mypkg'}, ['double', '--help'])
  expect(doubleHelp).toMatchInlineSnapshot(`
    "Usage: mypkg double [options] <the-number>

    double a number

    Arguments:
      the-number  number (required)

    Options:
      -h, --help  display help for command
    "
  `)
})

test('module positionals: positional arguments are validated and spread back into the function call', async () => {
  expect(await runWith({filename: positionalModulePath}, ['add', '2', '3'])).toMatchInlineSnapshot(`"5"`)
  expect(await runWith({filename: positionalModulePath}, ['double', '4'])).toMatchInlineSnapshot(`"8"`)
})

test('module positionals: optional positionals can be omitted', async () => {
  expect(await runWith({filename: positionalModulePath}, ['copy', 'a.txt', 'b.txt'])).toMatchInlineSnapshot(
    `"copied a.txt to b.txt"`,
  )
  expect(await runWith({filename: positionalModulePath}, ['copy', 'a.txt'])).toMatchInlineSnapshot(
    `"copied a.txt to a.txt.bak"`,
  )
  expect(await runWith({filename: positionalModulePath}, ['copy', 'a.txt', 'b.txt', '--force'])).toMatchInlineSnapshot(
    `"copied a.txt to b.txt (forced)"`,
  )
})

test('module positionals: parameter defaults kick in when the positional is omitted', async () => {
  expect(await runWith({filename: positionalModulePath}, ['repeat', 'hi'])).toMatchInlineSnapshot(`"hi hi"`)
  expect(await runWith({filename: positionalModulePath}, ['repeat', 'hi', '3'])).toMatchInlineSnapshot(`"hi hi hi"`)
})

test('module positionals: array parameters become variadic positionals', async () => {
  expect(await runWith({filename: positionalModulePath}, ['join-words', 'a', 'b', 'c'])).toMatchInlineSnapshot(
    `"a b c"`,
  )
  expect(
    await runWith({filename: positionalModulePath}, ['join-words', 'a', 'b', '--separator', '+']),
  ).toMatchInlineSnapshot(`"a+b"`)
})

test('module positionals: missing and invalid positionals fail before the function runs', async () => {
  await expect(runWith({filename: positionalModulePath}, ['add', '2'])).rejects.toMatchInlineSnapshot(`
    CLI exited with code 1
      Caused by: CommanderError: error: missing required argument 'right'
  `)
  await expect(runWith({filename: positionalModulePath}, ['add', '2', 'banana'])).rejects.toMatchInlineSnapshot(`
    CLI exited with code 1
      Caused by: CommanderError: error: command-argument value 'banana' is invalid for argument 'right'. Invalid number: banana
  `)
})

test('module positionals: unsupported signatures are ignored', async () => {
  const params = {
    source: `
      export function sum(...numbers: number[]) {
        return 0
      }

      export function move([x, y]: [number, number], options: {fast?: boolean}) {
        return x + y
      }

      export function deploy(options: {env: string}, target: string) {
        return target
      }

      export function lint(files?: string[]) {
        return files?.join(',') || ''
      }

      export function pad(text: string, width = 10) {
        return text + width
      }

      export function status() {
        return 'ok'
      }
    `,
    exports: {
      deploy: (_options: any, target: string) => target,
      lint: (files?: string[]) => files?.join(',') || '',
      move: ([x, y]: [number, number]) => x + y,
      pad: (text: string, width = 10) => text + width,
      status: () => 'ok',
      sum: () => 0,
    },
  }

  const help = await runWith(params, ['--help'])
  expect(help).toContain('status')
  expect(help).not.toContain('sum')
  expect(help).not.toContain('move')
  expect(help).not.toContain('deploy')
  expect(help).not.toContain('lint')
  expect(help).not.toContain('pad')
  expect(await runWith(params, ['status'])).toMatchInlineSnapshot(`"ok"`)
})

test('module commands: intersection and multi-line union type aliases keep their tails', async () => {
  const params = {
    // regression: these aliases used to be sliced at the first balanced `}`, silently dropping `& {...}`/union tails
    source: `
      type Opts = {mode: string} & {
        /** an extra flag from the intersection tail */
        extra: string
      }
      type Wide =
        | {kind: 'a'}
        | {kind: 'b'}

      export async function configure(options: Opts) {
        return options.mode + ':' + options.extra
      }
      export async function pick(options: {choice: Wide}) {
        return options.choice.kind
      }
    `,
    exports: {
      configure: async (options: any) => `${options.mode}:${options.extra}`,
      pick: async (options: any) => options.choice.kind,
    },
  }
  const help = await runWith(params, ['configure', '--help'])
  expect(help).toContain('--extra')
  expect(help).toContain('an extra flag from the intersection tail')
  expect(await runWith(params, ['configure', '--mode', 'fast', '--extra', 'yes'])).toMatchInlineSnapshot(`"fast:yes"`)
  // dropping the intersection tail would make --extra an unknown flag; dropping union variants would reject kind: 'b'
  await expect(runWith(params, ['configure', '--mode', 'fast'])).rejects.toThrowError(/extra/)
})

test('module commands: same-file extended interfaces and alias intersections derive flags', async () => {
  const params = {
    source: `
      interface Common {
        root: string
      }
      interface Named {
        name: string
      }
      interface Options extends Common, Named {
        tag: string
      }
      type Extra = Options & {
        verbose?: boolean
      }

      export function deploy(options: Extra) {
        return options.root + ':' + options.name + ':' + options.tag + ':' + String(options.verbose || false)
      }
    `,
    exports: {
      deploy: (options: any) => `${options.root}:${options.name}:${options.tag}:${String(options.verbose || false)}`,
    },
  }

  const help = await runWith(params, ['deploy', '--help'])
  expect(help).toContain('--root <string>')
  expect(help).toContain('--name <string>')
  expect(help).toContain('--tag <string>')
  expect(help).toContain('--verbose [boolean]')
  expect(
    await runWith(params, ['deploy', '--root', 'prod', '--name', 'api', '--tag', 'v1', '--verbose']),
  ).toMatchInlineSnapshot(`"prod:api:v1:true"`)
})

test('module commands: generic type parameters containing => are skipped correctly', async () => {
  const params = {
    // without the => exception in findBalancedEnd, the `>` of `() => void` would close the generic
    // bracket early and the whole declaration would mis-slice. (A *parameter* typed as a generic like
    // `callback?: T` is a different story - it is ignored unless the type can resolve into a CLI input.)
    source: `
      export async function run<T extends () => void>(options: {name: string}) {
        return 'ran ' + options.name
      }
    `,
    exports: {run: async (options: any) => `ran ${options.name}`},
  }
  expect(await runWith(params, ['run', '--name', 'build'])).toMatchInlineSnapshot(`"ran build"`)
})

test('module commands: jsdoc still attaches when a line comment sits between it and the declaration', async () => {
  const params = {
    source: `
      /** does the thing */
      // eslint-disable-next-line some-rule
      export async function thing(options: {input: string}) {
        return options.input
      }
    `,
    exports: {thing: async (options: any) => options.input},
  }
  expect(await runWith(params, ['--help'])).toContain('does the thing')
})

test('module commands: jsdoc aliases create command and option aliases without leaking into help', async () => {
  const params = {
    source: `
      /**
       * install dependencies
       * @alias i
       */
      export function install(options: {
        /** fail if the lockfile changed
         * @alias f
         */
        frozenLockfile?: boolean
      }) {
        return options.frozenLockfile ? 'frozen' : 'normal'
      }
    `,
    exports: {install: (options: any) => (options.frozenLockfile ? 'frozen' : 'normal')},
  }

  const rootHelp = await runWith(params, ['--help'])
  expect(rootHelp).toContain('install dependencies')
  expect(rootHelp).not.toContain('@alias')
  expect(await runWith(params, ['i', '-f'])).toMatchInlineSnapshot(`"frozen"`)

  const installHelp = await runWith(params, ['install', '--help'])
  expect(installHelp).toContain('-f, --frozen-lockfile')
  expect(installHelp).toContain('fail if the lockfile changed')
  expect(installHelp).not.toContain('@alias')
})

test('module commands: union-of-objects parameter derives union flags', async () => {
  const params = {
    // regression (caught in review): the flags-object decision briefly only accepted plain objects,
    // erroring on unions of objects which the base branch supported
    source: `
      export function fetchIt(options: {url: string} | {file: string}) {
        return 'url' in options ? 'fetching ' + options.url : 'reading ' + options.file
      }
    `,
    exports: {fetchIt: (options: any) => ('url' in options ? `fetching ${options.url}` : `reading ${options.file}`)},
  }
  const help = await runWith(params, ['fetch-it', '--help'])
  expect(help).toContain('--url')
  expect(help).toContain('--file')
  expect(await runWith(params, ['fetch-it', '--url', 'http://x'])).toMatchInlineSnapshot(`"fetching http://x"`)
  expect(await runWith(params, ['fetch-it', '--file', 'a.txt'])).toMatchInlineSnapshot(`"reading a.txt"`)
})

test('module positionals: trailing intersection-alias options object is flattened into flags', async () => {
  const params = {
    // pins the tuple-level mergeIntersection: without it the trailing allOf wouldn't register as a flags object
    source: `
      type Common = {verbose?: boolean}
      type Opts = Common & {tag: string}

      export function ship(name: string, options: Opts) {
        return name + ':' + options.tag + (options.verbose ? ' (verbose)' : '')
      }
    `,
    exports: {ship: (name: any, options: any) => `${name}:${options.tag}${options.verbose ? ' (verbose)' : ''}`},
  }
  const help = await runWith(params, ['ship', '--help'])
  expect(help).toContain('--tag')
  expect(help).toContain('--verbose')
  expect(await runWith(params, ['ship', 'v1', '--tag', 'latest', '--verbose'])).toMatchInlineSnapshot(
    `"v1:latest (verbose)"`,
  )
})

test('module positionals: boolean and literal-union positionals', async () => {
  const params = {
    source: `
      export function set(key: 'theme' | 'editor', enabled: boolean) {
        return key + '=' + enabled
      }
    `,
    exports: {set: (key: any, enabled: any) => `${key}=${enabled}`},
  }
  expect(await runWith(params, ['set', 'theme', 'true'])).toMatchInlineSnapshot(`"theme=true"`)
  await expect(runWith(params, ['set', 'nope', 'true'])).rejects.toThrowError(/nope/)
})

test('module commands: overloaded functions become alternate calling conventions', async () => {
  const params = {
    // TS overloads extract once per declaration: the body-less *signatures* first, the *implementation* (typically
    // widened, e.g. `params: any`) last. Every signature becomes a way to call the command: help shows one usage
    // line per signature (with its jsdoc as a trailing comment), the flags list is the union of all signatures'
    // flags, and validation checks each signature in declaration order, passing the first match to the function.
    source: `
      /** resize by explicit dimensions */
      export function resize(params: {
        /** path to the input image */
        input: string
        width: number
        height: number
      }): Promise<string>
      /** resize by scale factor, preserving aspect ratio */
      export function resize(params: {input: string; scale: number}): Promise<string>
      export function resize(params: any) {
        return 'resized'
      }
    `,
    exports: {
      resize: (input: any) =>
        'scale' in input
          ? `resized ${input.input} by ${input.scale}x`
          : `resized ${input.input} to ${input.width}x${input.height}`,
    },
  }

  expect(await runWith({...params, name: 'imgtool'}, ['resize', '--help'])).toMatchInlineSnapshot(`
    "Usage: imgtool resize --input <string> --width <number> --height <number>  # resize by explicit dimensions
           imgtool resize --input <string> --scale <number>                    # resize by scale factor, preserving aspect ratio

    resize by explicit dimensions

    Options:
      --input [string]   path to the input image
      --width [number]
      --height [number]
      --scale [number]
      -h, --help         display help for command
    "
  `)

  // each signature is dispatched by first match, in declaration order - the implementation branches on shape
  expect(await runWith(params, ['resize', '--input', 'a.png', '--width', '100', '--height', '50'])).toBe(
    'resized a.png to 100x50',
  )
  expect(await runWith(params, ['resize', '--input', 'a.png', '--scale', '0.5'])).toBe('resized a.png by 0.5x')

  // flags that never appear in the same signature are conflicting - commander catches the mix before validation
  await expect(runWith(params, ['resize', '--input', 'a.png', '--width', '100', '--scale', '2'])).rejects.toThrow(
    /'--width \[number]' cannot be used with option '--scale \[number]'/,
  )

  // matching no signature reports each signature's issues - closest match (fewest issues) first
  await expect(runWith(params, ['resize', '--input', 'a.png'])).rejects.toMatchInlineSnapshot(`
    CLI exited with code 1
      Caused by: Error: Invalid input: ✖ matched none of the 2 ways to call this command:
      --input <string> --width <number> --height <number>: must have required properties width, height
      --input <string> --scale <number>: must have required properties scale
  `)
})

test('module commands: overload signatures can use named types and required literals', async () => {
  const params = {
    // pnpm-install-style: a required `global: true` literal is the discriminator for the second calling
    // convention, and shows in its usage line as a bare required flag
    source: `
      type LocalInstall = {
        /** the package to install */
        name: string
        dev?: boolean
      }
      type GlobalInstall = {name: string; global: true; saveDir?: string}

      export function install(params: LocalInstall): Promise<string>
      export function install(params: GlobalInstall): Promise<string>
      export function install(params: any) {
        return 'installed'
      }
    `,
    exports: {
      install: (input: any) => `installed ${input.name}${input.global ? ' globally' : ''}`,
    },
  }
  const help = await runWith({...params, name: 'mypm'}, ['install', '--help'])
  expect(help).toContain('mypm install --name <string> [--dev]')
  expect(help).toContain('mypm install --name <string> --global [--save-dir <string>]')
  expect(help).toContain('the package to install') // property jsdoc survives the flag merge across signatures
  expect(await runWith(params, ['install', '--name', 'left-pad', '--global'])).toBe('installed left-pad globally')
  expect(await runWith(params, ['install', '--name', 'left-pad'])).toBe('installed left-pad')
})

test('module commands: class method overloads become alternate calling conventions', async () => {
  const params = {
    source: `
      export class Auth {
        /** log in with a personal access token */
        login(options: {token: string}): string
        /** log in with a username and password */
        login(options: {username: string; password: string}): string
        login(options: any) {
          return 'logged in'
        }
      }
    `,
    exports: {
      Auth: class {
        login(options: any) {
          return 'token' in options ? 'logged in with token' : `logged in as ${options.username}`
        }
      },
    },
  }
  const help = await runWith(params, ['auth', 'login', '--help'])
  // usage lines repeat the full nested command prefix and align the jsdoc comments across signatures
  expect(help).toContain(
    'Usage: program auth login --token <string>                         # log in with a personal access token',
  )
  expect(help).toContain(
    '       program auth login --username <string> --password <string>  # log in with a username and password',
  )
  expect(await runWith(params, ['auth', 'login', '--token', 'xyz'])).toBe('logged in with token')
  expect(await runWith(params, ['auth', 'login', '--username', 'amy', '--password', 'hunter2'])).toBe(
    'logged in as amy',
  )
})

test('module positionals: overloaded multi-parameter functions use the first overload signature', async () => {
  const params = {
    // alternate calling conventions are only derived for single-object-parameter signatures - commander has no way
    // to present alternate positional layouts, so overloads with positionals fall back to the first signature
    source: `
      /** greet someone */
      export function greet(name: string, options?: {shout?: boolean}): string
      export function greet(name: string): string
      export function greet(name: any, options?: any) {
        const greeting = 'hello ' + name
        return options?.shout ? greeting.toUpperCase() : greeting
      }
    `,
    exports: {
      greet: (name: any, options?: any) => {
        const greeting = 'hello ' + name
        return options?.shout ? greeting.toUpperCase() : greeting
      },
    },
  }
  // the first signature drives everything: the positional, the flags object, and (via its jsdoc) the description
  const help = await runWith(params, ['greet', '--help'])
  expect(help).toContain('<name>')
  expect(help).toContain('--shout')
  expect(help).toContain('greet someone')
  expect(await runWith(params, ['greet', 'world'])).toMatchInlineSnapshot(`"hello world"`)
  expect(await runWith(params, ['greet', 'world', '--shout'])).toMatchInlineSnapshot(`"HELLO WORLD"`)
})

test('module commands: async const arrow with explicit param type', async () => {
  const params = {
    source: `
      export const install = async (params: {name: string; dev?: boolean; exact?: boolean}) => {
        return 'installing ' + params.name + (params.dev ? ' (dev)' : '') + (params.exact ? ' (exact)' : '')
      }
    `,
    exports: {
      install: async (options: any) =>
        'installing ' + options.name + (options.dev ? ' (dev)' : '') + (options.exact ? ' (exact)' : ''),
    },
  }
  expect(await runWith(params, ['install', '--name', 'left-pad', '--dev'])).toMatchInlineSnapshot(
    `"installing left-pad (dev)"`,
  )
})

test('module commands: async const arrow with destructured param', async () => {
  const params = {
    // destructuring is fine in the options-object position - only *positional* params must be named
    source: `
      export const install = async ({name, dev, exact}: {name: string; dev?: boolean; exact?: boolean}) => {
        return 'installing ' + name + (dev ? ' (dev)' : '') + (exact ? ' (exact)' : '')
      }
    `,
    exports: {
      install: async ({name, dev, exact}: any) =>
        'installing ' + name + (dev ? ' (dev)' : '') + (exact ? ' (exact)' : ''),
    },
  }
  expect(await runWith(params, ['install', '--name', 'left-pad', '--exact'])).toMatchInlineSnapshot(
    `"installing left-pad (exact)"`,
  )
})

test('module commands: type-annotated const function exports are ignored', async () => {
  const params = {
    // `export const f: SomeType = ...` isn't parsed; the annotation would be the source of truth, and it can
    // reference imported types the extractor can't see.
    source: `
      type Cmd = (options: {name: string}) => string
      export const greet: Cmd = (options) => 'hi ' + options.name
      export function status() {
        return 'ok'
      }
    `,
    exports: {greet: (options: any) => 'hi ' + options.name, status: () => 'ok'},
  }
  const help = await runWith(params, ['--help'])
  expect(help).toContain('status')
  expect(help).not.toContain('greet')
  expect(await runWith(params, ['status'])).toMatchInlineSnapshot(`"ok"`)
})

test('module commands: exported classes create lazily-instantiated command groups', async () => {
  let constructed = 0
  class Users {
    constructor() {
      constructed++
    }

    invite(options: {email: string}) {
      this.#audit()
      return `invite ${options.email}`
    }

    private getOrCreate(email: string) {
      return {email}
    }

    login(email: string, password: string) {
      const user = this.getOrCreate(email)
      return `login ${user.email} with ${password.length} chars`
    }

    #audit() {
      return 'audited'
    }
  }

  const params = {
    source: `
      export class Users {
        constructor() {}

        /** invite a user
         * @alias i
         */
        invite(options: {
          /** address to invite */
          email: string
        }) {
          this.#audit()
          return 'invite ' + options.email
        }

        private getOrCreate(email: string) {
          return {email}
        }

        login(email: string, password: string) {
          const user = this.getOrCreate(email)
          return 'login ' + user.email + ' with ' + password.length + ' chars'
        }

        #audit() {
          return 'audited'
        }
      }
    `,
    exports: {Users},
  }

  const rootHelp = await runWith(params, ['--help'])
  expect(rootHelp).toContain('users')
  expect(constructed).toBe(0)

  const inviteHelp = await runWith(params, ['users', 'invite', '--help'])
  expect(inviteHelp).toContain('invite a user')
  expect(inviteHelp).toContain('--email <string>')
  expect(inviteHelp).toContain('address to invite')
  expect(inviteHelp).not.toContain('@alias')
  expect(inviteHelp).not.toContain('audit')
  expect(inviteHelp).not.toContain('get-or-create')
  expect(constructed).toBe(0)

  expect(await runWith(params, ['users', 'invite', '--email', 'ada@example.com'])).toMatchInlineSnapshot(
    `"invite ada@example.com"`,
  )
  expect(constructed).toBe(1)
  expect(await runWith(params, ['users', 'i', '--email', 'grace@example.com'])).toMatchInlineSnapshot(
    `"invite grace@example.com"`,
  )
  expect(constructed).toBe(2)
  expect(await runWith(params, ['users', 'login', 'ada@example.com', 's3cr3t'])).toMatchInlineSnapshot(
    `"login ada@example.com with 6 chars"`,
  )
  expect(constructed).toBe(3)
})

test('module commands: default exported class methods become root commands', async () => {
  let constructed = 0
  class Commands {
    constructor() {
      constructed++
    }

    invite(options: {email: string}) {
      return `invite ${options.email}`
    }
  }

  const params = {
    source: `
      export default class Commands {
        constructor() {}

        /** invite from the root */
        invite(options: {
          /** target email */
          email: string
        }) {
          return 'invite ' + options.email
        }

        private helper() {
          return 'not a command'
        }
      }
    `,
    exports: {default: Commands},
  }

  const rootHelp = await runWith(params, ['--help'])
  expect(rootHelp).toContain('invite')
  expect(rootHelp).toContain('invite from the root')
  expect(rootHelp).not.toContain('helper')
  expect(constructed).toBe(0)
  expect(await runWith(params, ['invite', '--email', 'ada@example.com'])).toMatchInlineSnapshot(
    `"invite ada@example.com"`,
  )
  expect(constructed).toBe(1)
})

test('module commands: inherited class groups require an explicit zero-arg constructor', async () => {
  class Base {
    protected prefix = 'base'
  }
  class Users extends Base {
    constructor() {
      super()
    }

    invite(options: {email: string}) {
      return `${this.prefix}:${options.email}`
    }
  }
  expect(
    await runWith(
      {
        source: `
          class Base {
            protected prefix = 'base'
          }
          export class Users extends Base {
            constructor() {
              super()
            }

            invite(options: {email: string}) {
              return this.prefix + ':' + options.email
            }
          }
        `,
        exports: {Users},
      },
      ['users', 'invite', '--email', 'ada@example.com'],
    ),
  ).toMatchInlineSnapshot(`"base:ada@example.com"`)
})

test('module commands: unsupported exported classes are ignored instead of throwing', async () => {
  class Base {}
  class NeedsConfig {
    constructor(config: {dryRun?: boolean}) {
      void config
    }

    invite(options: {email: string}) {
      return options.email
    }
  }
  class InheritedWithoutConstructor extends Base {
    invite(options: {email: string}) {
      return options.email
    }
  }
  class StaticOnly {}
  class AccessorOnly {
    get invite() {
      return 'not a command'
    }
  }
  class PrivateOnly {}

  const params = {
    source: `
      export class NeedsConfig {
        constructor(config: {dryRun?: boolean}) {}

        invite(options: {email: string}) {
          return options.email
        }
      }

      class Base {}
      export class InheritedWithoutConstructor extends Base {
        invite(options: {email: string}) {
          return options.email
        }
      }

      export class StaticOnly {
        static invite(options: {email: string}) {
          return options.email
        }
      }

      export class AccessorOnly {
        get invite() {
          return 'not a command'
        }
      }

      export class PrivateOnly {
        private invite(options: {email: string}) {
          return options.email
        }
      }

      export function status() {
        return 'ok'
      }
    `,
    exports: {
      AccessorOnly,
      InheritedWithoutConstructor,
      NeedsConfig,
      PrivateOnly,
      StaticOnly,
      status: () => 'ok',
    },
  }

  const help = await runWith(params, ['--help'])
  expect(help).toContain('status')
  expect(help).not.toContain('needs-config')
  expect(help).not.toContain('inherited-without-constructor')
  expect(help).not.toContain('static-only')
  expect(help).not.toContain('accessor-only')
  expect(help).not.toContain('private-only')
  expect(await runWith(params, ['status'])).toMatchInlineSnapshot(`"ok"`)
})

test('module positionals: destructured trailing options object works', async () => {
  const params = {
    // destructuring is only rejected for *positional* params - a trailing flags object may destructure
    source: `
      export function build(target: string, {minify}: {minify?: boolean}) {
        return 'built ' + target + (minify ? ' (minified)' : '')
      }
    `,
    exports: {build: (target: any, {minify}: any) => `built ${target}${minify ? ' (minified)' : ''}`},
  }
  expect(await runWith(params, ['build', 'web', '--minify'])).toMatchInlineSnapshot(`"built web (minified)"`)
})

const createReexportFixture = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trpc-cli-reexport-'))
  const write = (filename: string, source: string) => fs.writeFileSync(path.join(dir, filename), source, 'utf8')

  write(
    'barrel.ts',
    `
      export * from './root'
      export * as admin from './admin'
      export * as extra from './extra.mts'
      export {Users} from './users'

      export function localThing(options: {name: string}) {
        return \`local \${options.name}\`
      }
    `,
  )
  write(
    'root.ts',
    `
      /** command merged into the barrel root */
      export function rootThing(options: {value: string}) {
        return \`root \${options.value}\`
      }

      export const rootArrow = (options: {flag?: boolean}) => {
        return \`arrow \${options.flag === true ? 'on' : 'off'}\`
      }

      export default function hiddenDefault(options: {value: string}) {
        return \`hidden \${options.value}\`
      }
    `,
  )
  write(
    'admin.ts',
    `
      /** open the admin dashboard */
      export default function dashboard(options: {user: string}) {
        return \`dashboard \${options.user}\`
      }

      export function invite(options: {email: string}) {
        return \`invite \${options.email}\`
      }
    `,
  )
  write(
    'extra.mts',
    `
      export function ping(options: {name: string}) {
        return \`pong \${options.name}\`
      }
    `,
  )
  write(
    'users.ts',
    `
      export class Users {
        invite(options: {email: string}) {
          return \`user \${options.email}\`
        }
      }
    `,
  )

  return {
    barrelPath: path.join(dir, 'barrel.ts'),
    [Symbol.dispose]() {
      fs.rmSync(dir, {recursive: true, force: true})
    },
  }
}

const createImportedTypesFixture = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trpc-cli-imported-types-'))
  const write = (filename: string, source: string) => fs.writeFileSync(path.join(dir, filename), source, 'utf8')

  write(
    'commands.ts',
    `
      import type {InviteOptions as Options} from './types.js'
      import {type AssignOptions} from './types.js'

      export function invite(options: Options) {
        return \`invite \${options.email} as \${options.role || 'member'}\`
      }

      export default class Commands {
        assign(options: AssignOptions) {
          return \`assign \${options.id} to \${options.group}\`
        }
      }
    `,
  )
  write(
    'types.ts',
    `
      export interface InviteOptions {
        /** email to invite */
        email: string
        /** role to grant */
        role?: 'admin' | 'member'
      }

      export type AssignOptions = {
        /** user id */
        id: string
      } & {
        /** destination group */
        group: string
      }
    `,
  )

  return {
    commandsPath: path.join(dir, 'commands.ts'),
    [Symbol.dispose]() {
      fs.rmSync(dir, {recursive: true, force: true})
    },
  }
}
