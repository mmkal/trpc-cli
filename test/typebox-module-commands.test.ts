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

test('module commands: missing type annotation errors clearly', async () => {
  const params = {
    module: {
      source: `export function greet(name) { return 'hi ' + name }`,
      exports: {greet: (name: string) => 'hi ' + name},
    },
  }
  await expect(runWith(params, ['--help'])).rejects.toThrowError(
    'Parameter "name" of "greet" has no type annotation. Annotate it, e.g. `(name: string)` or `(name: {someFlag: string})`.',
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
    'The type of parameter "options" of "deploy" references "ImportedFromElsewhere", which couldn\'t be resolved. Declare it as `type X = {...}` or `interface X {...}` in the same file, or inline the type.',
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

// multi-parameter functions: leading scalar params -> positional arguments, trailing object param -> flags.
// fixture: test/fixtures/positional-commands-module.ts

const positionalModulePath = './test/fixtures/positional-commands-module.ts'

test('module positionals: scalar parameters show up as positional arguments in help', async () => {
  const addHelp = await runWith({module: positionalModulePath, name: 'mypkg'}, ['add', '--help'])
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
  const copyHelp = await runWith({module: positionalModulePath, name: 'mypkg'}, ['copy', '--help'])
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
  const doubleHelp = await runWith({module: positionalModulePath, name: 'mypkg'}, ['double', '--help'])
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
  expect(await runWith({module: positionalModulePath}, ['add', '2', '3'])).toMatchInlineSnapshot(`"5"`)
  expect(await runWith({module: positionalModulePath}, ['double', '4'])).toMatchInlineSnapshot(`"8"`)
})

test('module positionals: optional positionals can be omitted', async () => {
  expect(await runWith({module: positionalModulePath}, ['copy', 'a.txt', 'b.txt'])).toMatchInlineSnapshot(
    `"copied a.txt to b.txt"`,
  )
  expect(await runWith({module: positionalModulePath}, ['copy', 'a.txt'])).toMatchInlineSnapshot(
    `"copied a.txt to a.txt.bak"`,
  )
  expect(await runWith({module: positionalModulePath}, ['copy', 'a.txt', 'b.txt', '--force'])).toMatchInlineSnapshot(
    `"copied a.txt to b.txt (forced)"`,
  )
})

test('module positionals: parameter defaults kick in when the positional is omitted', async () => {
  expect(await runWith({module: positionalModulePath}, ['repeat', 'hi'])).toMatchInlineSnapshot(`"hi hi"`)
  expect(await runWith({module: positionalModulePath}, ['repeat', 'hi', '3'])).toMatchInlineSnapshot(`"hi hi hi"`)
})

test('module positionals: array parameters become variadic positionals', async () => {
  expect(await runWith({module: positionalModulePath}, ['join-words', 'a', 'b', 'c'])).toMatchInlineSnapshot(`"a b c"`)
  expect(
    await runWith({module: positionalModulePath}, ['join-words', 'a', 'b', '--separator', '+']),
  ).toMatchInlineSnapshot(`"a+b"`)
})

test('module positionals: missing and invalid positionals fail before the function runs', async () => {
  await expect(runWith({module: positionalModulePath}, ['add', '2'])).rejects.toMatchInlineSnapshot(`
    CLI exited with code 1
      Caused by: CommanderError: error: missing required argument 'right'
  `)
  await expect(runWith({module: positionalModulePath}, ['add', '2', 'banana'])).rejects.toMatchInlineSnapshot(`
    CLI exited with code 1
      Caused by: CommanderError: error: command-argument value 'banana' is invalid for argument 'right'. Invalid number: banana
  `)
})

test('module positionals: rest parameters error clearly', async () => {
  const params = {
    module: {
      source: `export function sum(...numbers: number[]) { return 0 }`,
      exports: {sum: () => 0},
    },
  }
  await expect(runWith(params, ['--help'])).rejects.toThrowError(
    'Parameter "...numbers" of "sum" is a rest parameter, which isn\'t supported. Use an explicitly-typed array parameter (e.g. `numbers: number[]`, which becomes a variadic positional argument), or move it into a trailing options object.',
  )
})

test('module positionals: destructured positional parameters error clearly', async () => {
  const params = {
    module: {
      source: `export function move([x, y]: [number, number], options: {fast?: boolean}) {}`,
      exports: {move: () => {}},
    },
  }
  await expect(runWith(params, ['--help'])).rejects.toThrowError(
    'Parameter 1 ("[number, number]") of "move" is a destructuring pattern, which isn\'t supported for positional arguments. Give the parameter a name, or move it into a trailing options object.',
  )
})

test('module positionals: object parameter in non-final position errors clearly', async () => {
  const params = {
    module: {
      source: `export function deploy(options: {env: string}, target: string) {}`,
      exports: {deploy: () => {}},
    },
  }
  await expect(runWith(params, ['--help'])).rejects.toThrowError(
    'Parameter 1 ("options") of "deploy" is an object type, but only the *last* parameter can be an object - leading parameters become positional arguments and a trailing object parameter maps to flags. Move it to the end, or flatten it into the trailing options object.',
  )
})

test('module positionals: optional array parameter errors clearly', async () => {
  const params = {
    module: {
      source: `export function lint(files?: string[]) {}`,
      exports: {lint: () => {}},
    },
  }
  await expect(runWith(params, ['--help'])).rejects.toThrowError(
    'Parameter 1 ("files") of "lint" is an optional array. Optional array parameters aren\'t supported as positional arguments - make it required, or move it into a trailing options object.',
  )
})

test('module positionals: default value without a type annotation errors clearly', async () => {
  const params = {
    module: {
      source: `export function pad(text: string, width = 10) { return text }`,
      exports: {pad: (text: string) => text},
    },
  }
  await expect(runWith(params, ['--help'])).rejects.toThrowError(
    'Parameter "width" of "pad" has no type annotation. Annotate it, e.g. `(width: string)` or `(width: {someFlag: string})`.',
  )
})

test('module commands: intersection and multi-line union type aliases keep their tails', async () => {
  const params = {
    module: {
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
    module: {
      // without the => exception in findBalancedEnd, the `>` of `() => void` would close the generic
      // bracket early and the whole declaration would mis-slice. (A *parameter* typed as a generic like
      // `callback?: T` is a different story - it errors as an unresolvable reference, by design.)
      source: `
        export async function run<T extends () => void>(options: {name: string}) {
          return 'ran ' + options.name
        }
      `,
      exports: {run: async (options: any) => `ran ${options.name}`},
    },
  }
  expect(await runWith(params, ['run', '--name', 'build'])).toMatchInlineSnapshot(`"ran build"`)
})

test('module commands: jsdoc still attaches when a line comment sits between it and the declaration', async () => {
  const params = {
    module: {
      source: `
        /** does the thing */
        // eslint-disable-next-line some-rule
        export async function thing(options: {input: string}) {
          return options.input
        }
      `,
      exports: {thing: async (options: any) => options.input},
    },
  }
  expect(await runWith(params, ['--help'])).toContain('does the thing')
})

test('module commands: union-of-objects parameter derives union flags', async () => {
  const params = {
    module: {
      // regression (caught in review): the flags-object decision briefly only accepted plain objects,
      // erroring on unions of objects which the base branch supported
      source: `
        export function fetchIt(options: {url: string} | {file: string}) {
          return 'url' in options ? 'fetching ' + options.url : 'reading ' + options.file
        }
      `,
      exports: {fetchIt: (options: any) => ('url' in options ? `fetching ${options.url}` : `reading ${options.file}`)},
    },
  }
  const help = await runWith(params, ['fetch-it', '--help'])
  expect(help).toContain('--url')
  expect(help).toContain('--file')
  expect(await runWith(params, ['fetch-it', '--url', 'http://x'])).toMatchInlineSnapshot(`"fetching http://x"`)
  expect(await runWith(params, ['fetch-it', '--file', 'a.txt'])).toMatchInlineSnapshot(`"reading a.txt"`)
})

test('module positionals: trailing intersection-alias options object is flattened into flags', async () => {
  const params = {
    module: {
      // pins the tuple-level mergeIntersection: without it the trailing allOf wouldn't register as a flags object
      source: `
        type Common = {verbose?: boolean}
        type Opts = Common & {tag: string}

        export function ship(name: string, options: Opts) {
          return name + ':' + options.tag + (options.verbose ? ' (verbose)' : '')
        }
      `,
      exports: {ship: (name: any, options: any) => `${name}:${options.tag}${options.verbose ? ' (verbose)' : ''}`},
    },
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
    module: {
      source: `
        export function set(key: 'theme' | 'editor', enabled: boolean) {
          return key + '=' + enabled
        }
      `,
      exports: {set: (key: any, enabled: any) => `${key}=${enabled}`},
    },
  }
  expect(await runWith(params, ['set', 'theme', 'true'])).toMatchInlineSnapshot(`"theme=true"`)
  await expect(runWith(params, ['set', 'nope', 'true'])).rejects.toThrowError(/nope/)
})

test('module positionals: destructured trailing options object works', async () => {
  const params = {
    module: {
      // destructuring is only rejected for *positional* params - a trailing flags object may destructure
      source: `
        export function build(target: string, {minify}: {minify?: boolean}) {
          return 'built ' + target + (minify ? ' (minified)' : '')
        }
      `,
      exports: {build: (target: any, {minify}: any) => `built ${target}${minify ? ' (minified)' : ''}`},
    },
  }
  expect(await runWith(params, ['build', 'web', '--minify'])).toMatchInlineSnapshot(`"built web (minified)"`)
})
