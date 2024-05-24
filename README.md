# trpc-cli

Turn a [tRPC](https://trpc.io) router into a type-safe, fully-functional, documented CLI.

<!-- codegen:start {preset: markdownTOC} -->
- [Installation](#installation)
- [Usage](#usage)
   - [Parameters and flags](#parameters-and-flags)
      - [Positional parameters](#positional-parameters)
      - [Flags](#flags)
      - [Both](#both)
   - [Calculator example](#calculator-example)
- [Output and lifecycle](#output-and-lifecycle)
- [Features and Limitations](#features-and-limitations)
- [More Examples](#more-examples)
   - [Migrator example](#migrator-example)
- [Programmatic usage](#programmatic-usage)
- [Out of scope](#out-of-scope)
- [Contributing](#contributing)
   - [Implementation and dependencies](#implementation-and-dependencies)
   - [Testing](#testing)
<!-- codegen:end -->

## Installation

```
npm install trpc-cli @trpc/server zod
```

## Usage

Start by writing a normal tRPC router:

```ts
import {initTRPC} from '@trpc/server'
import {z} from 'zod'

const t = initTRPC.create()

export const router = t.router({
  add: t.procedure
    .input(z.object({left: z.number(), right: z.number()}))
    .query(({input}) => input.left + input.right),
})
```

Then you can turn it into a fully-functional CLI by passing it to `trpcCli`

```ts
import {trpcCli} from 'trpc-cli'
import {router} from './router'

const cli = trpcCli({router})
cli.run()
```

And that's it! Your tRPC router is now a CLI program with help text and input validation.

You can also pass an existing tRPC router that's primarily designed to be deployed as a server to it, in order to invoke your procedures directly, in development.

### Parameters and flags

CLI positional parameters and flags are derived from each procedure's input type. Inputs should use a `zod` object or tuple type for the procedure to be mapped to a CLI command.

#### Positional parameters

Positional parameters passed to the CLI can be declared with a `z.tuple(...)` input type:

```ts
t.router({
  add: t.procedure
    .input(z.tuple([z.number(), z.number()]))
    .query(({input}) => input[0] + input[1]),
})
```

Which is invoked like `path/to/cli add 2 3` (outputting `5`).

>Note: positional parameters can use `.optional()` or `.nullish()`, but not `.nullable()`.

>Note: positional parameters can be named using `.describe('name of parameter')`, but names can not include any special characters.

#### Flags

`z.object(...)` inputs become flags (passed with `--foo bar` or `--foo=bar`) syntax. Values are accepted in either `--camelCase` or `--kebab-case`, and are parsed like in most CLI programs:

Strings:

- `z.object({foo: z.string()})` will map:
  - `--foo bar` or `--foo=bar` to `{foo: 'bar'}`

Booleans:

- `z.object({foo: z.boolean()})` will map:
   - `--foo` or `--foo=true` to `{foo: true}`
   - `--foo=false` to `{foo: false}`

>Note: it's usually better to use `z.boolean().optional()` than `z.boolean()`, otherwise CLI users will have to pass in `--foo=false`.

Numbers:

- `z.object({foo: z.number()})` will map:
   - `--foo 1` or `--foo=1` to `{foo: 1}`

Other types:
- `z.object({ foo: z.object({ bar: z.number() }) })` will parse inputs as JSON:
   - `--foo '{"bar": 1}'` maps to `{foo: {bar: 1}}`

Unions and intersections should also work as expected, but please test them thoroughly, especially if they are deeply-nested.

#### Both

To use positional parameters _and_ flags, use a tuple with an object at the end:

```ts
t.router({
  copy: t.procedure
    .input(
      z.tuple([
        z.string().describe('source'),
        z.string().describe('target'),
        z.object({
          mkdirp: z
            .boolean()
            .optional()
            .describe("Ensure target's parent directory exists before copying"),
        }),
      ]),
    )
    .mutation(async ({input: [source, target, opts]}) => {
      if (opts.mkdirp) {
        await fs.mkdir(path.dirname(target, {recursive: true}))
      }
      await fs.copyFile(source, target)
    }),
})
```

You might use the above with a command like:

```
path/to/cli copy a.txt b.txt --mkdirp
```

>Note: object types for flags must appear _last_ in the `.input` tuple, when being used with positional parameters. So `z.tuple([z.string(), z.object({mkdirp: z.boolean()}), z.string()])` would be allowed.

Procedures with incompatible inputs will be returned in the `ignoredProcedures` property.

### Calculator example

Here's a more involved example, along with what it outputs:

<!-- codegen:start {preset: custom, require: tsx/cjs, source: ./readme-codegen.ts, export: dump, file: test/fixtures/calculator.ts} -->
<!-- hash:b63bdbb21d0708bc6ce34e408c58f249 -->
```ts
import * as trpcServer from '@trpc/server'
import {TrpcCliMeta, trpcCli} from 'trpc-cli'
import {z} from 'zod'

const trpc = trpcServer.initTRPC.meta<TrpcCliMeta>().create()

const router = trpc.router({
  add: trpc.procedure
    .meta({
      description:
        'Add two numbers. Use this if you and your friend both have apples, and you want to know how many apples there are in total.',
    })
    .input(z.tuple([z.number(), z.number()]))
    .query(({input}) => input[0] + input[1]),
  subtract: trpc.procedure
    .meta({
      description:
        'Subtract two numbers. Useful if you have a number and you want to make it smaller.',
    })
    .input(z.tuple([z.number(), z.number()]))
    .query(({input}) => input[0] - input[1]),
  multiply: trpc.procedure
    .meta({
      description:
        'Multiply two numbers together. Useful if you want to count the number of tiles on your bathroom wall and are short on time.',
    })
    .input(z.tuple([z.number(), z.number()]))
    .query(({input}) => input[0] * input[1]),
  divide: trpc.procedure
    .meta({
      version: '1.0.0',
      description:
        "Divide two numbers. Useful if you have a number and you want to make it smaller and `subtract` isn't quite powerful enough for you.",
      examples: 'divide --left 8 --right 4',
    })
    .input(
      z.tuple([
        z.number().describe('numerator'),
        z
          .number()
          .refine(n => n !== 0)
          .describe('denominator'),
      ]),
    )
    .mutation(({input}) => input[0] / input[1]),
})

void trpcCli({router}).run()
```
<!-- codegen:end -->


Run `node path/to/cli --help` for formatted help text for the `sum` and `divide` commands.

<!-- codegen:start {preset: custom, require: tsx/cjs, source: ./readme-codegen.ts, export: command, command: './node_modules/.bin/tsx test/fixtures/calculator --help'} -->
`node path/to/calculator --help` output:

```
Commands:
  add             Add two numbers. Use this if you and your friend both have apples, and you want to know how many apples there are in total.
  subtract        Subtract two numbers. Useful if you have a number and you want to make it smaller.
  multiply        Multiply two numbers together. Useful if you want to count the number of tiles on your bathroom wall and are short on time.
  divide          Divide two numbers. Useful if you have a number and you want to make it smaller and `subtract` isn't quite powerful enough for you.

Flags:
  -h, --help                  Show help
      --verbose-errors        Throw raw errors (by default errors are summarised)

```
<!-- codegen:end -->

You can also show help text for the corresponding procedures (which become "commands" in the CLI):

<!-- codegen:start {preset: custom, require: tsx/cjs, source: ./readme-codegen.ts, export: command, command: './node_modules/.bin/tsx test/fixtures/calculator add --help'} -->
`node path/to/calculator add --help` output:

```
add

Add two numbers. Use this if you and your friend both have apples, and you want to know how many apples there are in total.

Usage:
  add [flags...] <parameter 1> <parameter 2>

Flags:
  -h, --help        Show help

```
<!-- codegen:end -->

When passing a command along with its flags, the return value will be logged to stdout:

<!-- codegen:start {preset: custom, require: tsx/cjs, source: ./readme-codegen.ts, export: command, command: './node_modules/.bin/tsx test/fixtures/calculator add --left 2 --right 3'} -->
`node path/to/calculator add --left 2 --right 3` output:

```
add

Add two numbers. Use this if you and your friend both have apples, and you want to know how many apples there are in total.

Usage:
  add [flags...] <parameter 1> <parameter 2>

Flags:
  -h, --help        Show help

Unexpected flags: left, right
```
<!-- codegen:end -->

Invalid inputs are helpfully displayed, along with help text for the associated command:

<!-- codegen:start {preset: custom, require: tsx/cjs, source: ./readme-codegen.ts, export: command, command: './node_modules/.bin/tsx test/fixtures/calculator add --left 2 --right notanumber'} -->
`node path/to/calculator add --left 2 --right notanumber` output:

```
add

Add two numbers. Use this if you and your friend both have apples, and you want to know how many apples there are in total.

Usage:
  add [flags...] <parameter 1> <parameter 2>

Flags:
  -h, --help        Show help

Unexpected flags: left, right
```
<!-- codegen:end -->


Note that procedures can define [`meta`](https://trpc.io/docs/server/metadata#create-router-with-typed-metadata) value with `description`, `usage` and `help` props. Zod's [`describe`](https://zod.dev/?id=describe) method allows adding descriptions to individual flags.

```ts
import {type TrpcCliMeta} from 'trpc-cli'

const trpc = initTRPC.meta<TrpcCliMeta>().create() // `TrpcCliMeta` is a helper interface with description, usage, and examples, but you can use your own `meta` interface, anything with a `description?: string` property will be fine

const appRouter = trpc.router({
  divide: trpc.procedure
    .meta({
      description:
        'Divide two numbers. Useful when you have a pizza and you want to share it equally between friends.',
    })
    .input(
      z.object({
        left: z.number().describe('The numerator of the division operator'),
        right: z.number().describe('The denominator of the division operator'),
      }),
    )
    .mutation(({input}) => input.left / input.right),
})
```

## Output and lifecycle

The output of the command will be logged via `console.info`. The process will exit with code 0 if the command was successful, or 1 otherwise. If you don't want to rely on this logging, you can always log inside your procedures and avoid returning a value. You can also override the `logger` and `process` properties of the `run` method:

<!-- eslint-disable unicorn/no-process-exit -->
```ts
import {trpcCli} from 'trpc-cli'

const cli = trpcCli({router: yourRouter})

cli.run({
  logger: yourLogger, // needs `.info` and `.error` methods
  process: {
    exit: code => {
      if (code === 0) process.exit(0)
      else process.exit(123)
    },
  },
})
```

You could also override `process.exit` to avoid killing the process at all - see [programmatic usage](#programmatic-usage) for an example.

## Features and Limitations

- Nested subrouters ([example](./test/fixtures//migrations.ts)) - command will be dot separated e.g. `search.byId`
- Middleware, `ctx`, multi-inputs work as normal
- Return values are logged using `console.info` (can be configured to pass in a custom logger)
- `process.exit(...)` called with either 0 or 1 depending on successful resolve
- Help text shown on invalid inputs
- Support kebab-case flag aliases
- Support flag aliases via `alias` callback (see migrations example below)
- Union types work, but they should ideally be non-overlapping for best results
- Limitation: Only zod types are supported right now
- Limitation: Only object types are allowed as input. No positional arguments supported
   - If there's interest, this could be added in future for inputs of type `z.string()` or `z.tuple([z.string(), ...])`
- Limitation: Nested-object input props must be passed as json
   - e.g. `z.object({ foo: z.object({ bar: z.number() }) }))` can be supplied via using `--foo '{"bar": 123}'`
   - If there's interest, support for `--foo.bar=1` could be added using [type-flag's dot-nested flags](https://github.com/privatenumber/type-flag?tab=readme-ov-file#dot-nested-flags) but edge cases/preprocessing needs proper consideration first.
- Limitation: No `subscription` support.
   - In theory, this might be supportable via `@inquirer/prompts`. Proposals welcome!

## More Examples

### Migrator example

Given a migrations router looking like this:

<!-- codegen:start {preset: custom, require: tsx/cjs, source: ./readme-codegen.ts, export: dump, file: test/fixtures/migrations.ts} -->
<!-- hash:57e812de50ced6dc1150ebe5498d5ecd -->
```ts
import * as trpcServer from '@trpc/server'
import {TrpcCliMeta, trpcCli} from 'trpc-cli'
import {z} from 'zod'

const trpc = trpcServer.initTRPC.meta<TrpcCliMeta>().create()

const migrations = getMigrations()

const searchProcedure = trpc.procedure
  .input(
    z.object({
      status: z
        .enum(['executed', 'pending'])
        .optional()
        .describe('Filter to only show migrations with this status'),
    }),
  )
  .use(async ({next, input}) => {
    return next({
      ctx: {
        filter: (list: typeof migrations) =>
          list.filter(m => !input.status || m.status === input.status),
      },
    })
  })

const router = trpc.router({
  apply: trpc.procedure
    .meta({
      description:
        'Apply migrations. By default all pending migrations will be applied.',
    })
    .input(
      z.union([
        z.object({}).strict(), // use strict here to make sure `{step: 1}` doesn't "match" this first, just by having an ignore `step` property
        z.object({
          to: z.string().describe('Mark migrations up to this one as exectued'),
        }),
        z.object({
          step: z
            .number()
            .int()
            .positive()
            .describe('Mark this many migrations as executed'),
        }),
      ]),
    )
    .query(async ({input}) => {
      let toBeApplied = migrations
      if ('to' in input) {
        const index = migrations.findIndex(m => m.name === input.to)
        toBeApplied = migrations.slice(0, index + 1)
      }
      if ('step' in input) {
        const start = migrations.findIndex(m => m.status === 'pending')
        toBeApplied = migrations.slice(0, start + input.step)
      }
      toBeApplied.forEach(m => (m.status = 'executed'))
      return migrations.map(m => `${m.name}: ${m.status}`)
    }),
  create: trpc.procedure
    .meta({description: 'Create a new migration'})
    .input(
      z.object({name: z.string(), content: z.string(), bb: z.boolean()}), //
    )
    .mutation(async ({input}) => {
      migrations.push({...input, status: 'pending'})
      return migrations
    }),
  list: searchProcedure
    .meta({description: 'List all migrations'})
    .query(({ctx}) => ctx.filter(migrations)),
  search: trpc.router({
    byName: searchProcedure
      .meta({description: 'Look for migrations by name'})
      .input(z.object({name: z.string()}))
      .query(({ctx, input}) => {
        return ctx.filter(migrations.filter(m => m.name === input.name))
      }),
    byContent: searchProcedure
      .meta({description: 'Look for migrations by their script content'})
      .input(
        z.object({
          searchTerm: z
            .string()
            .describe(
              'Only show migrations whose `content` value contains this string',
            ),
        }),
      )
      .query(({ctx, input}) => {
        return ctx.filter(
          migrations.filter(m => m.content.includes(input.searchTerm)),
        )
      }),
  }),
})

const cli = trpcCli({
  router,
  alias: (fullName, {command}) => {
    if (fullName === 'status') {
      return 's'
    }
    if (fullName === 'searchTerm' && command.startsWith('search.')) {
      return 'q'
    }
    return undefined
  },
})

void cli.run()

function getMigrations() {
  return [
    {
      name: 'one',
      content: 'create table one(id int, name text)',
      status: 'executed',
    },
    {
      name: 'two',
      content: 'create view two as select name from one',
      status: 'executed',
    },
    {
      name: 'three',
      content: 'create table three(id int, foo int)',
      status: 'pending',
    },
    {
      name: 'four',
      content: 'create view four as select foo from three',
      status: 'pending',
    },
    {name: 'five', content: 'create table five(id int)', status: 'pending'},
  ]
}
```
<!-- codegen:end -->

Here's how the CLI will work:

<!-- codegen:start {preset: custom, require: tsx/cjs, source: ./readme-codegen.ts, export: command, command: './node_modules/.bin/tsx test/fixtures/migrations --help'} -->
`node path/to/migrations --help` output:

```
Commands:
  apply                   Apply migrations. By default all pending migrations will be applied.
  create                  Create a new migration
  list                    List all migrations
  search.byName           Look for migrations by name
  search.byContent        Look for migrations by their script content

Flags:
  -h, --help                  Show help
      --verbose-errors        Throw raw errors (by default errors are summarised)

```
<!-- codegen:end -->

<!-- codegen:start {preset: custom, require: tsx/cjs, source: ./readme-codegen.ts, export: command, command: './node_modules/.bin/tsx test/fixtures/migrations apply --help'} -->
`node path/to/migrations apply --help` output:

```
apply

Apply migrations. By default all pending migrations will be applied.

Usage:
  apply [flags...]

Flags:
  -h, --help                 Show help
      --step <number>        Mark this many migrations as executed; Exclusive minimum: 0
      --to <string>          Mark migrations up to this one as exectued

```
<!-- codegen:end -->

<!-- codegen:start {preset: custom, require: tsx/cjs, source: ./readme-codegen.ts, export: command, command: './node_modules/.bin/tsx test/fixtures/migrations search.byContent --help'} -->
`node path/to/migrations search.byContent --help` output:

```
search.byContent

Look for migrations by their script content

Usage:
  search.byContent [flags...]

Flags:
  -h, --help                        Show help
  -q, --search-term <string>        Only show migrations whose `content` value contains this string
  -s, --status <string>             Filter to only show migrations with this status; Enum: executed,pending

```
<!-- codegen:end -->

## Programmatic usage

This library should probably _not_ be used programmatically - the functionality all comes from a trpc router, which has [many other ways to be invoked](https://trpc.io/docs/community/awesome-trpc). But if you really need to for some reason, you could override the `console.error` and `process.exit` calls:

```ts
import {trpcCli} from 'trpc-cli'

const cli = trpcCli({router: yourAppRouter})

const runCli = async (argv: string[]) => {
  return new Promise<void>((resolve, reject) => {
    cli.run({
      argv,
      logger: yourLogger, // needs `info` and `error` methods, at least
      process: {
        exit: code => {
          if (code === 0) {
            resolve()
          } else {
            reject(`CLI failed with exit code ${code}`)
          }
        },
      },
    })
  })
}
```

Note that even if you do this, help text may get writted directly to stdout by `cleye`. If that's a problem, [raise an issue](https://github.com/mmkal/trpc-cli/issues) - it could be solved by exposing some `cleye` configuration to the `run` method.

## Out of scope

- No stdin reading - I'd recommend using [`@inquirer/prompts`](https://npmjs.com/package/@inquirer/prompts) which is type safe and easy to use
- No stdout prettiness other than help text - use [`tasuku`](https://npmjs.com/package/tasuku) or [`listr2`](https://npmjs.com/package/listr2)

## Contributing

### Implementation and dependencies

- [cleye](https://npmjs.com/package/cleye) for parsing arguments before passing to trpc
- [zod-to-json-schema](https://npmjs.com/package/zod-to-json-schema) to convert zod schemas to make them easier to recurse and format help text from
- [zod-validation-error](https://npmjs.com/package/zod-validation-error) to make bad inputs have readable error messages

`zod` and `@tprc/server` are peer dependencies - right now only zod 3+ and @trpc/server 10+ have been tested, but it may work with most versions of zod.

### Testing

[`vitest`](https://npmjs.com/package/vitest) is used for testing, but the tests consists of the example fixtures from this readme, executed as CLIs via a subprocess. Avoiding mocks this way ensures fully realistic outputs (the tradeoff being test-speed, but they're acceptably fast for now).
