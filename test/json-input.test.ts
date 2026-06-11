import {initTRPC} from '@trpc/server'
import {expect, test} from 'vitest'
import {z} from 'zod/v4'
import {TrpcCliMeta} from '../src/index.js'
import {run, runWith, snapshotSerializer} from './test-run.js'

expect.addSnapshotSerializer(snapshotSerializer)

const t = initTRPC.meta<TrpcCliMeta>().create()

test('--json accepts complete inputs for mapped procedures', async () => {
  const router = t.router({
    object: t.procedure.input(z.object({foo: z.string(), count: z.number()})).query(({input}) => JSON.stringify(input)),
    tuple: t.procedure
      .input(z.tuple([z.string(), z.object({right: z.number()})]))
      .query(({input}) => JSON.stringify(input)),
    positionals: t.procedure
      .input(z.object({first: z.string().meta({positional: true}), shout: z.boolean().optional()}))
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
  expect(await runWith({router, jsonInput: true}, ['tuple', '--json', '["left",{"right":3}]'])).toMatchInlineSnapshot(
    `"["left",{"right":3}]"`,
  )
  expect(
    await runWith({router, jsonInput: true}, ['positionals', '--json', '{"first":"hi","shout":true}']),
  ).toMatchInlineSnapshot(`"{"first":"hi","shout":true}"`)
  expect(
    await runWith({router, jsonInput: true}, ['deeply', 'nested', 'command', '--json', '{"name":"Ada"}']),
  ).toMatchInlineSnapshot(`"hello Ada"`)
})

test('--json cannot be combined with schema-derived flags', async () => {
  const router = t.router({
    object: t.procedure.input(z.object({foo: z.string(), count: z.number()})).query(({input}) => JSON.stringify(input)),
  })

  // when --json is passed, the command is built JSON-only, so schema-derived flags simply don't exist
  await expect(runWith({router, jsonInput: true}, ['object', '--foo', 'bar', '--json', '{"foo":"bar","count":2}']))
    .rejects.toMatchInlineSnapshot(`
      CLI exited with code 1
        Caused by: CommanderError: error: unknown option '--foo'
    `)
})

test('--json cannot be combined with positional arguments', async () => {
  const router = t.router({
    greet: t.procedure
      .input(z.object({name: z.string().meta({positional: true})}))
      .query(({input}) => `hello ${input.name}`),
  })

  await expect(runWith({router, jsonInput: true}, ['greet', 'Ada', '--json', '{"name":"Bob"}'])).rejects
    .toMatchInlineSnapshot(`
      CLI exited with code 1
        Caused by: CommanderError: error: too many arguments for 'greet'. Expected 0 arguments but got 1.
    `)
})

test('--json with variadic positional arguments', async () => {
  const router = t.router({
    list: t.procedure.input(z.array(z.string())).query(({input}) => JSON.stringify(input)),
  })

  expect(await runWith({router, jsonInput: true}, ['list', '--json', '["x","y"]'])).toMatchInlineSnapshot(`"["x","y"]"`)
  await expect(runWith({router, jsonInput: true}, ['list', 'a', 'b', '--json', '["x"]'])).rejects
    .toMatchInlineSnapshot(`
      CLI exited with code 1
        Caused by: CommanderError: error: too many arguments for 'list'. Expected 0 arguments but got 2.
    `)
})

test('--json rejects malformed json', async () => {
  const router = t.router({
    object: t.procedure.input(z.object({foo: z.string(), count: z.number()})).query(({input}) => JSON.stringify(input)),
  })

  await expect(runWith({router, jsonInput: true}, ['object', '--json', '{not-json'])).rejects.toMatchInlineSnapshot(`
    CLI exited with code 1
      Caused by: CommanderError: error: option '--json <json>' argument '{not-json' is invalid. Malformed JSON. If passing a string, pass it as a valid JSON string with quotes ("{not-json")
  `)
})

test('--json payloads still go through procedure validation', async () => {
  const router = t.router({
    object: t.procedure.input(z.object({foo: z.string(), count: z.number()})).query(({input}) => JSON.stringify(input)),
  })

  await expect(
    runWith({router, jsonInput: true}, ['object', '--json', '{"foo":"bar"}']), // missing required `count`
  ).rejects.toMatchInlineSnapshot(`
    CLI exited with code 1
      Caused by: CliValidationError: ✖ Invalid input: expected number, received undefined → at count
  `)
  await expect(
    runWith({router, jsonInput: true}, ['object', '--json', '{"foo":"bar","count":"two"}']), // wrong type for `count`
  ).rejects.toMatchInlineSnapshot(`
    CLI exited with code 1
      Caused by: CliValidationError: ✖ Invalid input: expected number, received string → at count
  `)
})

test('--json=equals form activates json mode', async () => {
  const router = t.router({
    object: t.procedure.input(z.object({foo: z.string(), count: z.number()})).query(({input}) => JSON.stringify(input)),
  })

  expect(await runWith({router, jsonInput: true}, ['object', '--json={"foo":"bar","count":2}'])).toMatchInlineSnapshot(
    `"{"foo":"bar","count":2}"`,
  )
})

test('literal --json after -- terminator does not activate json mode', async () => {
  const router = t.router({
    echo: t.procedure
      .input(z.object({text: z.string().meta({positional: true})}))
      .query(({input}) => `echoed: ${input.text}`),
  })

  // after `--`, tokens are operands, not options - so `--json` here is a positional value, and the command is built from its schema
  expect(await runWith({router, jsonInput: true}, ['echo', '--', '--json'])).toMatchInlineSnapshot(`"echoed: --json"`)
})

test('explicit run({argv}) is sniffed, not process.argv', async () => {
  const router = t.router({
    object: t.procedure.input(z.object({foo: z.string(), count: z.number()})).query(({input}) => JSON.stringify(input)),
  })

  const originalArgv = process.argv
  process.argv = [...originalArgv.slice(0, 2), 'object', '--json', '{"foo":"from-process-argv","count":1}']
  try {
    // the explicit argv has no --json, so flags mode should be used, even though process.argv has --json
    expect(await runWith({router, jsonInput: true}, ['object', '--foo', 'bar', '--count', '2'])).toMatchInlineSnapshot(
      `"{"foo":"bar","count":2}"`,
    )
  } finally {
    process.argv = originalArgv
  }
})

test('help in flags mode shows --json on leaf commands; json-mode help shows only --json', async () => {
  const router = t.router({
    object: t.procedure.input(z.object({foo: z.string(), count: z.number()})).query(({input}) => JSON.stringify(input)),
  })

  expect(await runWith({router, jsonInput: true}, ['object', '--help'])).toMatchInlineSnapshot(`
    "Usage: program object [options]

    Options:
      --foo <string>
      --count <number>
      --json <json>     Provide the complete procedure input as JSON - other flags
                        and positional arguments are unavailable when using this
                        option
      -h, --help        display help for command
    "
  `)
  expect(await runWith({router, jsonInput: true}, ['object', '--json', '{}', '--help'], {expectJsonInput: true}))
    .toMatchInlineSnapshot(`
      "Usage: program object [options]

      Options:
        --json <json>  Input formatted as JSON
        -h, --help     display help for command
      "
    `)
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
})

test('meta.jsonInput: false opts a procedure out of global json input', async () => {
  const router = t.router({
    optedOut: t.procedure
      .meta({jsonInput: false})
      .input(z.object({foo: z.string().optional()}))
      .query(({input}) => JSON.stringify(input)),
    optedIn: t.procedure.input(z.object({foo: z.string()})).query(({input}) => JSON.stringify(input)),
  })

  expect(await runWith({router, jsonInput: true}, ['opted-out', '--foo', 'bar'])).toMatchInlineSnapshot(
    `"{"foo":"bar"}"`,
  )
  expect(await runWith({router, jsonInput: true}, ['opted-out', '--help'])).not.toContain('--json')
  await expect(runWith({router, jsonInput: true}, ['opted-out', '--json', '{"foo":"bar"}'])).rejects
    .toMatchInlineSnapshot(`
      CLI exited with code 1
        Caused by: CommanderError: error: unknown option '--json'
    `)
  // sibling procedures without the opt-out still accept --json in the same invocation style
  expect(await runWith({router, jsonInput: true}, ['opted-in', '--json', '{"foo":"bar"}'])).toMatchInlineSnapshot(
    `"{"foo":"bar"}"`,
  )
})

test('meta.jsonInput: true procedures use --json', async () => {
  const router = t.router({
    legacy: t.procedure
      .meta({jsonInput: true})
      .input(z.object({foo: z.string()}))
      .query(({input}) => JSON.stringify(input)),
  })

  // no global jsonInput setting needed - meta.jsonInput makes the procedure JSON-only
  expect(await run(router, ['legacy', '--json', '{"foo":"bar"}'], {expectJsonInput: true})).toMatchInlineSnapshot(
    `"{"foo":"bar"}"`,
  )
  expect(await run(router, ['legacy', '--help'], {expectJsonInput: true})).toMatchInlineSnapshot(`
    "Usage: program legacy [options]

    Options:
      --json <json>  Input formatted as JSON
      -h, --help     display help for command
    "
  `)
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

test('procedures with a property named json defer to the global --json option', async () => {
  const router = t.router({
    withJsonProperty: t.procedure
      .input(z.object({json: z.string(), other: z.string().optional()}))
      .query(({input}) => JSON.stringify(input)),
  })

  // passing --json always activates JSON mode, so the schema property can only be supplied through the JSON payload
  expect(
    await runWith({router, jsonInput: true}, ['with-json-property', '--json', '{"json":"123"}']),
  ).toMatchInlineSnapshot(`"{"json":"123"}"`)
})
