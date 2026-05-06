import {initTRPC} from '@trpc/server'
import {expect, test} from 'vitest'
import {z} from 'zod/v4'
import {TrpcCliMeta} from '../src/index.js'
import {run, runWith, snapshotSerializer} from './test-run.js'

expect.addSnapshotSerializer(snapshotSerializer)

const t = initTRPC.meta<TrpcCliMeta>().create()

test('global json input accepts complete inputs for mapped procedures', async () => {
  const router = t.router({
    object: t.procedure.input(z.object({foo: z.string(), count: z.number()})).query(({input}) => JSON.stringify(input)),
    primitive: t.procedure.input(z.string()).query(({input}) => input.toUpperCase()),
    tuple: t.procedure
      .input(z.tuple([z.string(), z.object({right: z.number()})]))
      .query(({input}) => JSON.stringify(input)),
    deeply: t.router({
      nested: t.router({
        command: t.procedure.input(z.object({name: z.string()})).query(({input}) => `hello ${input.name}`),
      }),
    }),
  })

  expect(
    await runWith({router, jsonInput: true}, ['object', '--json', '{"foo":"bar","count":2}']),
  ).toMatchInlineSnapshot(`"{"foo":"bar","count":2}"`)
  expect(await runWith({router, jsonInput: true}, ['primitive', '--json', '"hello"'])).toMatchInlineSnapshot(`"HELLO"`)
  expect(await runWith({router, jsonInput: true}, ['tuple', '--json', '["left",{"right":3}]'])).toMatchInlineSnapshot(
    `"["left",{"right":3}]"`,
  )
  expect(
    await runWith({router, jsonInput: true}, ['deeply', 'nested', 'command', '--json', '{"name":"Ada"}']),
  ).toMatchInlineSnapshot(`"hello Ada"`)
})

test('global json input is opt-in', async () => {
  const router = t.router({
    object: t.procedure.input(z.object({foo: z.string().optional()})).query(({input}) => JSON.stringify(input)),
  })

  expect(await run(router, ['object', '--help'])).not.toContain('--json')
  await expect(run(router, ['object', '--json', '{"foo":"bar"}'])).rejects.toMatchInlineSnapshot(`
    CLI exited with code 1
      Caused by: CommanderError: error: unknown option '--json'
  `)

  expect(await runWith({router, jsonInput: true}, ['object', '--help'])).toContain('--json <json>')
})

test('global json input preserves per-procedure meta json input', async () => {
  const router = t.router({
    legacy: t.procedure
      .meta({jsonInput: true})
      .input(z.object({foo: z.string()}))
      .query(({input}) => JSON.stringify(input)),
  })

  expect(
    await runWith({router, jsonInput: true}, ['legacy', '--input', '{"foo":"from-input"}'], {
      expectJsonInput: true,
    }),
  ).toMatchInlineSnapshot(`"{"foo":"from-input"}"`)
  expect(
    await runWith({router, jsonInput: true}, ['legacy', '--json', '{"foo":"from-json"}'], {
      expectJsonInput: true,
    }),
  ).toMatchInlineSnapshot(`"{"foo":"from-json"}"`)

  const help = await runWith({router, jsonInput: true}, ['legacy', '--help'], {expectJsonInput: true})
  expect(help).toContain('--input [json]')
  expect(help).toContain('--json <json>')
})

test('global json input works through default command forwarding', async () => {
  const router = t.router({
    defaultCommand: t.procedure
      .meta({default: true})
      .input(z.object({foo: z.string()}))
      .query(({input}) => JSON.stringify(input)),
  })

  expect(await runWith({router, jsonInput: true}, ['--json', '{"foo":"bar"}'])).toMatchInlineSnapshot(`"{"foo":"bar"}"`)
})

test('global json input supports procedure properties named json through the complete input object', async () => {
  const router = t.router({
    withJsonProperty: t.procedure
      .input(z.object({json: z.string(), other: z.string().optional()}))
      .query(({input}) => JSON.stringify(input)),
    withOptionalJsonProperty: t.procedure
      .input(z.object({json: z.string().optional(), name: z.string()}))
      .query(({input}) => JSON.stringify(input)),
  })

  expect(
    await runWith({router, jsonInput: true}, ['with-json-property', '--json', '{"json":"123"}']),
  ).toMatchInlineSnapshot(`"{"json":"123"}"`)
  expect(
    await runWith({router, jsonInput: true}, ['with-optional-json-property', '--name', 'Ada']),
  ).toMatchInlineSnapshot(`"{"name":"Ada"}"`)

  const help = await runWith({router, jsonInput: true}, ['with-json-property', '--help'])
  expect(help).toContain('--json <json>')
  expect(help).not.toContain('--json <string>')
})

test('global json input ignores aliases named json', async () => {
  const router = t.router({
    withJsonAlias: t.procedure
      .meta({aliases: {options: {value: 'json'}}})
      .input(z.object({value: z.string()}))
      .query(({input}) => JSON.stringify(input)),
  })

  expect(
    await runWith({router, jsonInput: true}, ['with-json-alias', '--json', '{"value":"from-json"}']),
  ).toMatchInlineSnapshot(`"{"value":"from-json"}"`)
  expect(await runWith({router, jsonInput: true}, ['with-json-alias', '--value', 'from-flag'])).toMatchInlineSnapshot(
    `"{"value":"from-flag"}"`,
  )

  const help = await runWith({router, jsonInput: true}, ['with-json-alias', '--help'])
  expect(help).toContain('--json <json>')
  expect(help).toContain('--value <string>')
  expect(help).not.toContain('--json, --value')
})

test('global json input cannot be combined with positional arguments', async () => {
  const router = t.router({
    primitive: t.procedure.input(z.string()).query(({input}) => input.toUpperCase()),
  })

  await expect(runWith({router, jsonInput: true}, ['primitive', 'ignored', '--json', '"hello"'])).rejects.toThrow(
    /Cannot combine --json with positional arguments/,
  )
})
