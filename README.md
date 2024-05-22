# trpc-cli

Turn any [trpc](https://trpc.io) router into a fully-functional, documented CLI.

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

```
Commands:
  sum           
  divide        

Flags:
      --full-errors        Throw unedited raw errors rather than summarising to make more human-readable.
  -h, --help               Show help
```

Running `node router.js sum --help` and `node router.js divide --help` will show help text for the corresponding procedures:

```
sum

Usage:
  sum [flags...]

Flags:
  -h, --help                  Show help
      --left <number>         
      --right <number>
```

## Features

Procedures can define [`meta`](https://trpc.io/docs/server/metadata#create-router-with-typed-metadata) value with `description`, `usage` and `help` props. Zod's [`describe`](https://zod.dev/?id=describe) method allows adding descriptions to individual flags.

```ts
const appRouter = trpc.router({
  divide: trpc.procedure
    .input(
      z.object({
        left: z.number().describe('The numerator of the division operator'),
        right: z.number().describe('The denominator of the division operator'),
      }),
    )
    .mutation(({input}) => input.left / input.right),
})
```

## Limitations

- Only zod types are supported right now

## Implementation

- [cleye](https://npmjs.com/package/cleye) for parsing arguments before passing to trpc
- [zod-to-json-schema](https://npmjs.com/package/zod-to-json-schema) to convert zod schemas to make them easier to recusive
- [zod-validation-error](https://npmjs.com/package/zod-validation-error) to make bad inputs have readable error messages
