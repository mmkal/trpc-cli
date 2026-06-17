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
const reexportModulePath = './test/fixtures/reexport-barrel.ts'

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

test('module commands: missing type annotation errors clearly', async () => {
  const params = {
    source: `export function greet(name) { return 'hi ' + name }`,
    exports: {greet: (name: string) => 'hi ' + name},
  }
  await expect(runWith(params, ['--help'])).rejects.toThrowError(
    'Parameter "name" of "greet" has no type annotation. Annotate it, e.g. `(name: string)` or `(name: {someFlag: string})`.',
  )
})

test('module commands: unresolvable named type errors clearly', async () => {
  const params = {
    source: `export function deploy(options: ImportedFromElsewhere) {}`,
    exports: {deploy: () => {}},
  }
  await expect(runWith(params, ['--help'])).rejects.toThrowError(
    'The type of parameter "options" of "deploy" references "ImportedFromElsewhere", which couldn\'t be resolved. Declare it as `type X = {...}` or `interface X {...}` in the same file, or inline the type.',
  )
})

test('module commands: exported function with no parseable declaration errors clearly', async () => {
  const params = {
    // `export {fn}` statements aren't supported by the extractor - the error should say so
    source: `const start = () => 'started'\nexport {start}`,
    exports: {start: () => 'started'},
  }
  await expect(runWith(params, ['--help'])).rejects.toThrowError(
    /Could not find a parseable declaration for exported function\(s\) "start"/,
  )
})

test('module commands: export * merges child module commands at the root', async () => {
  expect(await runWith({filename: reexportModulePath}, ['root-thing', '--value', 'abc'])).toMatchInlineSnapshot(
    `"root abc"`,
  )
  expect(await runWith({filename: reexportModulePath}, ['root-arrow', '--flag'])).toMatchInlineSnapshot(`"arrow on"`)
  expect(await runWith({filename: reexportModulePath}, ['local-thing', '--name', 'Ada'])).toMatchInlineSnapshot(
    `"local Ada"`,
  )

  const help = await runWith({filename: reexportModulePath}, ['--help'])
  expect(help).toContain('root-thing')
  expect(help).toContain('root-arrow')
  expect(help).not.toContain('hidden-default')
})

test('module commands: export * as namespace builds a nested sub-router', async () => {
  expect(await runWith({filename: reexportModulePath}, ['admin', 'invite', '--email', 'ada@example.com']))
    .toMatchInlineSnapshot(`
      "invite ada@example.com"
    `)
  expect(await runWith({filename: reexportModulePath}, ['admin', '--user', 'Ada'])).toMatchInlineSnapshot(
    `"dashboard Ada"`,
  )
  expect(await runWith({filename: reexportModulePath}, ['admin', 'dashboard', '--user', 'Ada'])).toMatchInlineSnapshot(
    `"dashboard Ada"`,
  )

  const rootHelp = await runWith({filename: reexportModulePath}, ['--help'])
  expect(rootHelp).toContain('admin')
})

test('module commands: re-exported module resolution supports exact well-known extensions', async () => {
  expect(await runWith({filename: reexportModulePath}, ['extra', 'ping', '--name', 'Ada'])).toMatchInlineSnapshot(
    `"pong Ada"`,
  )
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

test('module positionals: rest parameters error clearly', async () => {
  const params = {
    source: `export function sum(...numbers: number[]) { return 0 }`,
    exports: {sum: () => 0},
  }
  await expect(runWith(params, ['--help'])).rejects.toThrowError(
    'Parameter "...numbers" of "sum" is a rest parameter, which isn\'t supported. Use an explicitly-typed array parameter (e.g. `numbers: number[]`, which becomes a variadic positional argument), or move it into a trailing options object.',
  )
})

test('module positionals: destructured positional parameters error clearly', async () => {
  const params = {
    source: `export function move([x, y]: [number, number], options: {fast?: boolean}) {}`,
    exports: {move: () => {}},
  }
  await expect(runWith(params, ['--help'])).rejects.toThrowError(
    'Parameter 1 ("[number, number]") of "move" is a destructuring pattern, which isn\'t supported for positional arguments. Give the parameter a name, or move it into a trailing options object.',
  )
})

test('module positionals: object parameter in non-final position errors clearly', async () => {
  const params = {
    source: `export function deploy(options: {env: string}, target: string) {}`,
    exports: {deploy: () => {}},
  }
  await expect(runWith(params, ['--help'])).rejects.toThrowError(
    'Parameter 1 ("options") of "deploy" is an object type, but only the *last* parameter can be an object - leading parameters become positional arguments and a trailing object parameter maps to flags. Move it to the end, or flatten it into the trailing options object.',
  )
})

test('module positionals: optional array parameter errors clearly', async () => {
  const params = {
    source: `export function lint(files?: string[]) {}`,
    exports: {lint: () => {}},
  }
  await expect(runWith(params, ['--help'])).rejects.toThrowError(
    'Parameter 1 ("files") of "lint" is an optional array. Optional array parameters aren\'t supported as positional arguments - make it required, or move it into a trailing options object.',
  )
})

test('module positionals: default value without a type annotation errors clearly', async () => {
  const params = {
    source: `export function pad(text: string, width = 10) { return text }`,
    exports: {pad: (text: string) => text},
  }
  await expect(runWith(params, ['--help'])).rejects.toThrowError(
    'Parameter "width" of "pad" has no type annotation. Annotate it, e.g. `(width: string)` or `(width: {someFlag: string})`.',
  )
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

test('module commands: generic type parameters containing => are skipped correctly', async () => {
  const params = {
    // without the => exception in findBalancedEnd, the `>` of `() => void` would close the generic
    // bracket early and the whole declaration would mis-slice. (A *parameter* typed as a generic like
    // `callback?: T` is a different story - it errors as an unresolvable reference, by design.)
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

test('module commands: overloaded functions use the first overload signature', async () => {
  const params = {
    // TS overloads extract once per declaration. The *implementation* signature is typically widened
    // (`options: any`) - using it would produce a misleading error. TS resolves calls against the overload
    // signatures in order, so the FIRST signature is the primary documented shape and becomes the command's
    // calling convention; the implementation and later overloads are ignored.
    source: `
      export function f(options: {mode: 'a'}): string
      export function f(options: {mode: 'b'}): number
      export function f(options: any) { return options.mode }
    `,
    exports: {f: (options: any) => options.mode},
  }
  expect(await runWith(params, ['f', '--mode', 'a'])).toMatchInlineSnapshot(`"a"`)
  // the second overload is ignored, so 'b' is rejected - the CLI presents exactly one calling convention
  await expect(runWith(params, ['f', '--mode', 'b'])).rejects.toMatchInlineSnapshot(`
    CLI exited with code 1
      Caused by: Error: Invalid input: ✖ must be equal to constant → at mode
  `)
})

test('module positionals: overloaded multi-parameter functions use the first overload signature', async () => {
  const params = {
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

test('module commands: type-annotated const declarations error with parseable-declaration guidance', async () => {
  const params = {
    // `export const f: SomeType = ...` isn't parsed (the annotation would be the source of truth, and it can
    // reference imported types the extractor can't see) - the existing actionable error applies
    source: `
      type Cmd = (options: {name: string}) => string
      export const greet: Cmd = (options) => 'hi ' + options.name
    `,
    exports: {greet: (options: any) => 'hi ' + options.name},
  }
  await expect(runWith(params, ['--help'])).rejects.toThrowError(
    /Could not find a parseable declaration for exported function\(s\) "greet"/,
  )
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
