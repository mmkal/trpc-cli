# trpc-cli

Turn a [trpc](https://trpc.io) router into a type-safe, fully-functional, documented CLI.

<!-- codegen:start {preset: markdownTOC} -->
- [Installation](#installation)
- [Usage](#usage)
- [Features and Limitations](#features-and-limitations)
- [Examples](#examples)
   - [Migrator](#migrator)
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

```ts
// router.js
import * as trpcServer from '@trpc/server'
import {trpcCli} from 'trpc-cli'
import {z} from 'zod'

const trpc = trpcServer.initTRPC.create()

const appRouter = trpc.router({
  sum: trpc.procedure
    .input(
      z.object({
        left: z.number(),
        right: z.number(),
      }),
    )
    .mutation(({input}) => input.left + input.right),
  divide: trpc.procedure
    .input(
      z.object({
        left: z.number(),
        right: z.number().refine(n => n !== 0),
      }),
    )
    .query(({input}) => input.left / input.right),
})

const cli = trpcCli({router: appRouter})

cli.run()
```

Then run `node router.js --help` and you will see formatted help text for the `sum` and `divide` commands.

<!-- codegen:start {preset: custom, require: tsx/cjs, source: ./readme-codegen.ts, export: command, command: './node_modules/.bin/tsx test/fixtures/calculator --help'} -->
`node path/to/calculator --help` output:

```
Commands:
  add             Add two numbers. Use this if you have apples, and someone else has some other apples, and you want to know how many apples in total you have.
  subtract        Subtract two numbers. Useful if you have a number and you want to make it smaller.
  multiply        Multiply two numbers together. Useful if you want to count the number of tiles on your bathroom wall and are short on time.
  divide          Divide two numbers. Useful if you have a number and you want to make it smaller and `subtract` isn't quite powerful enough for you.

Flags:
      --full-errors        Throw unedited raw errors rather than summarising to make more human-readable.
  -h, --help               Show help

```
<!-- codegen:end -->

You can also show help text for the corresponding procedures (which become "commands" in the CLI):

<!-- codegen:start {preset: custom, require: tsx/cjs, source: ./readme-codegen.ts, export: command, command: './node_modules/.bin/tsx test/fixtures/calculator add --help'} -->
`node path/to/calculator add --help` output:

```
add

Add two numbers. Use this if you have apples, and someone else has some other apples, and you want to know how many apples in total you have.

Usage:
  add [flags...]

Flags:
  -h, --help                  Show help
      --left <number>         The first number
      --right <number>        The second number

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

## Features and Limitations

- Nested subrouters ([example](./test/fixtures//migrations.ts)) - command will be dot separated e.g. `search.byId`
- Middleware, `ctx`, multi-inputs work as normal
- Return values are logged using `console.info` (can be configured to pass in a custom logger)
- `process.exit(...)` called with either 0 or 1 depending on successful resolve
- Help text shown on invalid inputs
- Support flag aliases via `alias` callback (see migrations example below)
- Union types work, but they should ideally be non-overlapping for best results
- Limitation: Only zod types are supported right now
- Limitaion: Onlly object types are allowed as input. No positional arguments supported
   - If there's interest, this could be added in future for inputs of type `z.string()` or `z.tuple([z.string(), ...])`
- Limitation: Nested-object input props must be passed as json
   - e.g. `z.object({ foo: z.object({ bar: z.number() }) }))` can be supplied via using `--foo '{"bar": 123}'`
   - If there's interest, support for `--foo.bar=1` could be added using [type-flag's dot-nested flags](https://github.com/privatenumber/type-flag?tab=readme-ov-file#dot-nested-flags) but edge cases/preprocessing needs proper consideration first.
- Limitation: No `subscription` support.
   - In theory, this might be supportable via `@inquirer/prompts`. Proposals welcome!

## Examples

### Migrator

Given a migrator looking like this:

<!-- codegen:start {preset: custom, require: tsx/cjs, source: ./readme-codegen.ts, export: dump, file: test/fixtures/migrations.ts} -->
<!-- hash:3ea2e96cb52cb641cc4c47c300d15dbe -->
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
        z.object({
          to: z
            .string()
            .optional()
            .describe('Mark migrations up to this one as exectued'),
          step: z.never().optional(),
        }),
        z.object({
          to: z.never().optional(),
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
      if (typeof input.to === 'string') {
        const index = migrations.findIndex(m => m.name === input.to)
        toBeApplied = migrations.slice(0, index + 1)
      }
      if (typeof input.step === 'number') {
        const start = migrations.findIndex(m => m.status === 'pending')
        toBeApplied = migrations.slice(0, start + input.step)
      }
      toBeApplied.forEach(m => (m.status = 'executed'))
      return migrations.map(m => `${m.name}: ${m.status}`)
    }),
  create: trpc.procedure
    .meta({description: 'Create a new migration'})
    .input(
      z.object({name: z.string(), content: z.string()}), //
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
      --full-errors        Throw unedited raw errors rather than summarising to make more human-readable.
  -h, --help               Show help

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
  -h, --help                Show help
      --step <value>        Mark this many migrations as executed; exclusiveMinimum: 0; Do not use with: --to
      --to <string>         Mark migrations up to this one as exectued; Do not use with: --step

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
  -s, --status <string>             Filter to only show migrations with this status; enum: executed,pending

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

`zod` and `@tprc/server` are peer dependencies - right now only zod 3 and @trpc/server v11 have been tested, but it may work with most versions of zod, and @trpc/server >= 10.

### Testing

[`vitest`](https://npmjs.com/package/vitest) is used for testing, but the tests consists of the example fixtures from this readme, executed as CLIs via a subprocess. Avoiding mocks this way ensures fully realistic outputs (the tradeoff being test-speed, but they're acceptably fast for now).
