import {initTRPC} from '@trpc/server'
import {expect, test} from 'vitest'
import {z} from 'zod'
import {AnyRouter, createCli, TrpcCliMeta, TrpcCliParams} from '../src/index.js'
import {looksLikeInstanceof} from '../src/util.js'

expect.addSnapshotSerializer({
  test: val => looksLikeInstanceof(val, Error),
  serialize(val, config, indentation, depth, refs, printer) {
    let topLine = `${val.constructor.name}: ${val.message}`
    if (val.constructor.name === 'FailedToExitError') topLine = `CLI exited with code ${val.exitCode}`

    if (!val.cause) return topLine
    indentation += '  '
    return `${topLine}\n${indentation}Caused by: ${printer(val.cause, config, indentation, depth + 1, refs)}`
      .split(/(---|Usage:)/)[0] // strip out the usage line and the --- line which is added for debugging when tests fail
      .trim()
  },
})

const t = initTRPC.meta<TrpcCliMeta>().create()

const run = <R extends AnyRouter>(router: R, argv: string[]) => {
  return runWith({router}, argv)
}
const runWith = <R extends AnyRouter>(params: TrpcCliParams<R>, argv: string[]) => {
  const cli = createCli(params)
  const logs = [] as unknown[][]
  const addLogs = (...args: unknown[]) => logs.push(args)
  return cli
    .run({
      argv,
      logger: {info: addLogs, error: addLogs},
      process: {exit: _ => 0 as never},
    })
    .catch(e => {
      if (e.exitCode === 0 && e.cause.message === '(outputHelp)') return logs?.[0]?.[0] // should be the help text
      if (e.exitCode === 0) return e.cause
      throw e
    })
}

test('options with various modifiers', async () => {
  const router = t.router({
    test: t.procedure
      .input(
        z.object({
          stringWithDefault: z.string().default('hello'),
          literalWithDefault: z.literal('hi').default('hi'),
          unionWithDefault: z.union([z.literal('foo'), z.literal('bar')]).default('foo'),
          numberWithDefault: z.number().default(42),
          booleanWithDefault: z.boolean().default(true),
          booleanOrNumber: z.union([z.boolean(), z.number()]),
          enumWithDefault: z.enum(['foo', 'bar']).default('foo'),
          arrayWithDefault: z.array(z.string()).default(['hello']),
          objectWithDefault: z.object({foo: z.string()}).default({foo: 'bar'}),
          arrayOfObjectsWithDefault: z.array(z.object({foo: z.string()})).default([{foo: 'bar'}]),
          arrayOfEnumsWithDefault: z.array(z.enum(['foo', 'bar'])).default(['foo']),
          arrayOfUnionsWithDefault: z.array(z.union([z.literal('foo'), z.literal('bar')])).default(['foo']),
          arrayOfNumbersWithDefault: z.array(z.number()).default([42]),
          arrayOfBooleansWithDefault: z.array(z.boolean()).default([true]),

          numberWithMinAndMax: z.number().min(0).max(10),
          regex: z.string().regex(/^[a-z]+$/),
        }),
      )
      .query(({input}) => Object.entries(input).join(', ')),
  })

  // fix for annoying leading space: https://github.com/tj/commander.js/pull/2348
  expect(await run(router, ['test', '--help'])).toMatchInlineSnapshot(`
    "Usage: program test [options]

    Options:
      --string-with-default [string]                (default: "hello")
      --literal-with-default [string]               Const: hi (default: "hi")
      --union-with-default [string]                 (choices: "foo", "bar", default: "foo")
      --number-with-default [number]                (default: 42)
      --boolean-with-default [boolean]              (default: true)
      --boolean-or-number [value]                   type: boolean or number (default: false)
      --enum-with-default [string]                  (choices: "foo", "bar", default: "foo")
      --array-with-default [values...]              Type: string array (default: ["hello"])
      --object-with-default [json]                  Object (json formatted); Required: ["foo"] (default: {"foo":"bar"})
      --array-of-objects-with-default [values...]   Type: object; Object (json formatted); Required: ["foo"] array (default: [{"foo":"bar"}])
      --array-of-enums-with-default [values...]     Type: string array (choices: "foo", "bar", default: ["foo"])
      --array-of-unions-with-default [values...]    Type: string array (choices: "foo", "bar", default: ["foo"])
      --array-of-numbers-with-default [values...]   Type: number array (default: [42])
      --array-of-booleans-with-default [values...]  Type: boolean array (default: [true])
      --number-with-min-and-max <number>            Minimum: 0; Maximum: 10
      --regex <string>                              Pattern: ^[a-z]+$
      -h, --help                                    display help for command
    "
  `)
})
