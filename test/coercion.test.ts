import {initTRPC} from '@trpc/server'
import {expect, test} from 'vitest'
import {z} from 'zod/v4'
import {TrpcCliMeta} from '../src/index.js'
import {run, snapshotSerializer} from './test-run.js'

expect.addSnapshotSerializer(snapshotSerializer)

const t = initTRPC.meta<TrpcCliMeta>().create()

test('values that fail to coerce are left for the schema to reject', async () => {
  const router = t.router({
    count: t.procedure.input(z.object({count: z.int()})).query(({input}) => JSON.stringify(input)),
    port: t.procedure.input(z.tuple([z.number()])).query(({input}) => JSON.stringify(input)),
  })

  await expect(run(router, ['count', '--count', '1.5'])).rejects.toMatchInlineSnapshot(`
    CLI exited with code 1
      Caused by: CliValidationError: error: option '--count <integer>' argument '1.5' is invalid. Invalid input: expected int, received number
  `)
  await expect(run(router, ['count', '--count', 'abc'])).rejects.toMatchInlineSnapshot(`
    CLI exited with code 1
      Caused by: CliValidationError: error: option '--count <integer>' argument 'abc' is invalid. Invalid input: expected number, received string
  `)
  await expect(run(router, ['port', 'abc'])).rejects.toMatchInlineSnapshot(`
    CLI exited with code 1
      Caused by: CliValidationError: error: command-argument value 'abc' is invalid for argument 'parameter_1'. Invalid input: expected number, received string
  `)
  // `Number('')` is 0, but an empty string isn't a number
  await expect(run(router, ['count', '--count', ''])).rejects.toMatchInlineSnapshot(`
    CLI exited with code 1
      Caused by: CliValidationError: error: option '--count <integer>' argument '' is invalid. Invalid input: expected number, received string
  `)
  await expect(run(router, ['port', ''])).rejects.toMatchInlineSnapshot(`
    CLI exited with code 1
      Caused by: CliValidationError: error: command-argument value '' is invalid for argument 'parameter_1'. Invalid input: expected number, received string
  `)
})

test('nullable strings take plain strings', async () => {
  const router = t.router({
    greet: t.procedure.input(z.object({name: z.string().nullable()})).query(({input}) => JSON.stringify(input)),
  })

  expect(await run(router, ['greet', '--name', 'bob'])).toMatchInlineSnapshot(`"{"name":"bob"}"`)
  expect(await run(router, ['greet', '--name', '123'])).toMatchInlineSnapshot(`"{"name":"123"}"`)
  expect(await run(router, ['greet', '--name', '"bob"'])).toMatchInlineSnapshot(`"{"name":"bob"}"`)
})

test('nullable positionals', async () => {
  const router = t.router({
    limit: t.procedure.input(z.tuple([z.number().nullable()])).query(({input}) => JSON.stringify(input)),
  })

  expect(await run(router, ['limit', '5'])).toMatchInlineSnapshot(`"[5]"`)
  expect(await run(router, ['limit', 'null'])).toMatchInlineSnapshot(`"[null]"`)
  await expect(run(router, ['limit', 'abc'])).rejects.toMatchInlineSnapshot(`
    CLI exited with code 1
      Caused by: CliValidationError: error: command-argument value 'abc' is invalid for argument 'parameter_1'. Invalid input: expected number, received string
  `)
})

test('positionals accepting strings or objects', async () => {
  const router = t.router({
    target: t.procedure
      .input(z.tuple([z.union([z.string(), z.object({host: z.string()})])]))
      .query(({input}) => JSON.stringify(input)),
  })

  expect(await run(router, ['target', 'localhost'])).toMatchInlineSnapshot(`"["localhost"]"`)
  expect(await run(router, ['target', '{"host":"localhost"}'])).toMatchInlineSnapshot(`"[{"host":"localhost"}]"`)
})

test('malformed json is reported before the schema sees it', async () => {
  const router = t.router({
    config: t.procedure
      .input(z.object({config: z.object({retries: z.number()})}))
      .query(({input}) => JSON.stringify(input)),
  })

  await expect(run(router, ['config', '--config', '{retries: 1}'])).rejects.toMatchInlineSnapshot(`
    CLI exited with code 1
      Caused by: CommanderError: error: option '--config [json]' argument '{retries: 1}' is invalid. Malformed JSON.
  `)
  await expect(run(router, ['config', '--config', '[1]'])).rejects.toMatchInlineSnapshot(`
    CLI exited with code 1
      Caused by: CliValidationError: error: option '--config [json]' argument '[1]' is invalid. Invalid input: expected object, received array
  `)
})

test('required enum options are mandatory, like other required options', async () => {
  const router = t.router({
    paint: t.procedure.input(z.object({color: z.enum(['red', 'blue'])})).query(({input}) => JSON.stringify(input)),
  })

  await expect(run(router, ['paint'])).rejects.toMatchInlineSnapshot(`
    CLI exited with code 1
      Caused by: CommanderError: error: required option '--color <string>' not specified
  `)
  await expect(run(router, ['paint', '--color', 'green'])).rejects.toMatchInlineSnapshot(`
    CLI exited with code 1
      Caused by: CommanderError: error: option '--color <string>' argument 'green' is invalid. Allowed choices are red, blue.
  `)
})
