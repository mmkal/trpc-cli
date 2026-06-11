import {initTRPC} from '@trpc/server'
import {expect, test} from 'vitest'
import {z} from 'zod/v4'
import {TrpcCliMeta} from '../src/index.js'
import {run, runWith, snapshotSerializer} from './test-run.js'

expect.addSnapshotSerializer(snapshotSerializer)

const t = initTRPC.meta<TrpcCliMeta>().create()

test('--json accepts complete inputs by default - no configuration needed', async () => {
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

  expect(await run(router, ['object', '--json', '{"foo":"bar","count":2}'])).toMatchInlineSnapshot(
    `"{"foo":"bar","count":2}"`,
  )
  expect(await run(router, ['tuple', '--json', '["left",{"right":3}]'])).toMatchInlineSnapshot(
    `"["left",{"right":3}]"`,
  )
  expect(await run(router, ['positionals', '--json', '{"first":"hi","shout":true}'])).toMatchInlineSnapshot(
    `"{"first":"hi","shout":true}"`,
  )
  expect(await run(router, ['deeply', 'nested', 'command', '--json', '{"name":"Ada"}'])).toMatchInlineSnapshot(
    `"hello Ada"`,
  )
})

test('--json cannot be combined with schema-derived flags', async () => {
  const router = t.router({
    object: t.procedure.input(z.object({foo: z.string(), count: z.number()})).query(({input}) => JSON.stringify(input)),
  })

  // when --json is passed, the command is built JSON-only, so schema-derived flags simply don't exist
  await expect(run(router, ['object', '--foo', 'bar', '--json', '{"foo":"bar","count":2}'])).rejects
    .toMatchInlineSnapshot(`
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

  await expect(run(router, ['greet', 'Ada', '--json', '{"name":"Bob"}'])).rejects.toMatchInlineSnapshot(`
    CLI exited with code 1
      Caused by: CommanderError: error: too many arguments for 'greet'. Expected 0 arguments but got 1.
  `)
})

test('--json with variadic positional arguments', async () => {
  const router = t.router({
    list: t.procedure.input(z.array(z.string())).query(({input}) => JSON.stringify(input)),
  })

  expect(await run(router, ['list', '--json', '["x","y"]'])).toMatchInlineSnapshot(`"["x","y"]"`)
  await expect(run(router, ['list', 'a', 'b', '--json', '["x"]'])).rejects.toMatchInlineSnapshot(`
    CLI exited with code 1
      Caused by: CommanderError: error: too many arguments for 'list'. Expected 0 arguments but got 2.
  `)
})

test('--json rejects malformed json', async () => {
  const router = t.router({
    object: t.procedure.input(z.object({foo: z.string(), count: z.number()})).query(({input}) => JSON.stringify(input)),
  })

  await expect(run(router, ['object', '--json', '{not-json'])).rejects.toMatchInlineSnapshot(`
    CLI exited with code 1
      Caused by: CommanderError: error: option '--json <json>' argument '{not-json' is invalid. Malformed JSON. If passing a string, pass it as a valid JSON string with quotes ("{not-json")
  `)
})

test('--json payloads still go through procedure validation', async () => {
  const router = t.router({
    object: t.procedure.input(z.object({foo: z.string(), count: z.number()})).query(({input}) => JSON.stringify(input)),
  })

  await expect(
    run(router, ['object', '--json', '{"foo":"bar"}']), // missing required `count`
  ).rejects.toMatchInlineSnapshot(`
    CLI exited with code 1
      Caused by: CliValidationError: ✖ Invalid input: expected number, received undefined → at count
  `)
  await expect(
    run(router, ['object', '--json', '{"foo":"bar","count":"two"}']), // wrong type for `count`
  ).rejects.toMatchInlineSnapshot(`
    CLI exited with code 1
      Caused by: CliValidationError: ✖ Invalid input: expected number, received string → at count
  `)
})

test('--json=equals form activates json mode', async () => {
  const router = t.router({
    object: t.procedure.input(z.object({foo: z.string(), count: z.number()})).query(({input}) => JSON.stringify(input)),
  })

  expect(await run(router, ['object', '--json={"foo":"bar","count":2}'])).toMatchInlineSnapshot(
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
  expect(await run(router, ['echo', '--', '--json'])).toMatchInlineSnapshot(`"echoed: --json"`)
})

test('explicit run({argv}) is sniffed, not process.argv', async () => {
  const router = t.router({
    object: t.procedure.input(z.object({foo: z.string(), count: z.number()})).query(({input}) => JSON.stringify(input)),
  })

  const originalArgv = process.argv
  process.argv = [...originalArgv.slice(0, 2), 'object', '--json', '{"foo":"from-process-argv","count":1}']
  try {
    // the explicit argv has no --json, so flags mode should be used, even though process.argv has --json
    expect(await run(router, ['object', '--foo', 'bar', '--count', '2'])).toMatchInlineSnapshot(
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

  expect(await run(router, ['object', '--help'])).toMatchInlineSnapshot(`
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
  expect(await run(router, ['object', '--json', '{}', '--help'], {expectJsonInput: true})).toMatchInlineSnapshot(`
    "Usage: program object [options]

    Options:
      --json <json>  Input formatted as JSON
      -h, --help     display help for command
    "
  `)
})

test(`jsonInput: 'never' disables --json globally`, async () => {
  const router = t.router({
    object: t.procedure.input(z.object({foo: z.string().optional()})).query(({input}) => JSON.stringify(input)),
  })

  expect(await runWith({router, jsonInput: 'never'}, ['object', '--help'])).not.toContain('--json')
  await expect(runWith({router, jsonInput: 'never'}, ['object', '--json', '{"foo":"bar"}'])).rejects
    .toMatchInlineSnapshot(`
      CLI exited with code 1
        Caused by: CommanderError: error: unknown option '--json'
    `)
  // schema-derived flags still work as usual
  expect(await runWith({router, jsonInput: 'never'}, ['object', '--foo', 'bar'])).toMatchInlineSnapshot(
    `"{"foo":"bar"}"`,
  )
})

test(`jsonInput: 'always' makes every command JSON-only`, async () => {
  const router = t.router({
    object: t.procedure.input(z.object({foo: z.string(), count: z.number()})).query(({input}) => JSON.stringify(input)),
  })

  expect(
    await runWith({router, jsonInput: 'always'}, ['object', '--json', '{"foo":"bar","count":2}'], {
      expectJsonInput: true,
    }),
  ).toMatchInlineSnapshot(`"{"foo":"bar","count":2}"`)
  // schema-derived flags don't exist at all - even without --json in the argv
  await expect(runWith({router, jsonInput: 'always'}, ['object', '--foo', 'bar', '--count', '2'])).rejects
    .toMatchInlineSnapshot(`
      CLI exited with code 1
        Caused by: CommanderError: error: unknown option '--foo'
    `)
  expect(await runWith({router, jsonInput: 'always'}, ['object', '--help'], {expectJsonInput: true}))
    .toMatchInlineSnapshot(`
      "Usage: program object [options]

      Options:
        --json <json>  Input formatted as JSON
        -h, --help     display help for command
      "
    `)
})

test(`meta jsonInput overrides the global setting`, async () => {
  const router = t.router({
    neverJson: t.procedure
      .meta({jsonInput: 'never'})
      .input(z.object({foo: z.string().optional()}))
      .query(({input}) => JSON.stringify(input)),
    alwaysJson: t.procedure
      .meta({jsonInput: 'always'})
      .input(z.object({foo: z.string()}))
      .query(({input}) => JSON.stringify(input)),
    autoJson: t.procedure
      .meta({jsonInput: 'auto'})
      .input(z.object({foo: z.string()}))
      .query(({input}) => JSON.stringify(input)),
  })

  // meta 'never' under the default global 'auto': flags work, no --json in help, --json is an unknown option
  expect(await run(router, ['never-json', '--foo', 'bar'])).toMatchInlineSnapshot(`"{"foo":"bar"}"`)
  expect(await run(router, ['never-json', '--help'])).not.toContain('--json')
  await expect(run(router, ['never-json', '--json', '{"foo":"bar"}'])).rejects.toMatchInlineSnapshot(`
    CLI exited with code 1
      Caused by: CommanderError: error: unknown option '--json'
  `)

  // meta 'always' under global 'never': JSON-only regardless
  expect(
    await runWith({router, jsonInput: 'never'}, ['always-json', '--json', '{"foo":"bar"}'], {expectJsonInput: true}),
  ).toMatchInlineSnapshot(`"{"foo":"bar"}"`)

  // meta 'auto' under global 'never': hybrid behavior for this command only
  expect(await runWith({router, jsonInput: 'never'}, ['auto-json', '--json', '{"foo":"bar"}'])).toMatchInlineSnapshot(
    `"{"foo":"bar"}"`,
  )
  expect(await runWith({router, jsonInput: 'never'}, ['auto-json', '--foo', 'bar'])).toMatchInlineSnapshot(
    `"{"foo":"bar"}"`,
  )

  // meta 'never' under global 'always': built from its schema regardless
  expect(await runWith({router, jsonInput: 'always'}, ['never-json', '--foo', 'bar'])).toMatchInlineSnapshot(
    `"{"foo":"bar"}"`,
  )
})

test(`meta jsonInput: 'always' procedures are JSON-only`, async () => {
  const router = t.router({
    legacy: t.procedure
      .meta({jsonInput: 'always'})
      .input(z.object({foo: z.string()}))
      .query(({input}) => JSON.stringify(input)),
  })

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
  await expect(run(router, ['legacy', '--foo', 'bar'])).rejects.toMatchInlineSnapshot(`
    CLI exited with code 1
      Caused by: CommanderError: error: unknown option '--foo'
  `)
})

test('boolean jsonInput values are rejected with a migration message', async () => {
  const router = t.router({
    object: t.procedure.input(z.object({foo: z.string()})).query(({input}) => JSON.stringify(input)),
  })

  await expect(runWith({router, jsonInput: true as never}, ['object', '--foo', 'bar'])).rejects.toThrow(
    `jsonInput: true is no longer supported - use 'always'`,
  )
  await expect(runWith({router, jsonInput: false as never}, ['object', '--foo', 'bar'])).rejects.toThrow(
    `jsonInput: false is no longer supported - use 'never'`,
  )

  const booleanMetaRouter = t.router({
    object: t.procedure
      .meta({jsonInput: false as never})
      .input(z.object({foo: z.string()}))
      .query(({input}) => JSON.stringify(input)),
  })
  await expect(run(booleanMetaRouter, ['object', '--foo', 'bar'])).rejects.toThrow(
    `jsonInput: false is no longer supported - use 'never'`,
  )
})

test('global json input works through default command forwarding', async () => {
  const router = t.router({
    defaultCommand: t.procedure
      .meta({default: true})
      .input(z.object({foo: z.string()}))
      .query(({input}) => JSON.stringify(input)),
  })

  expect(await run(router, ['--json', '{"foo":"bar"}'])).toMatchInlineSnapshot(`"{"foo":"bar"}"`)
})

test('schema wins: a procedure with its own json property keeps its schema-derived --json flag', async () => {
  const router = t.router({
    withJsonProperty: t.procedure
      .input(z.object({json: z.string(), other: z.string().optional()}))
      .query(({input}) => JSON.stringify(input)),
    sibling: t.procedure.input(z.object({foo: z.string()})).query(({input}) => JSON.stringify(input)),
  })

  // even though --json is sniffed in the argv, this command's schema already defines `json`, so the schema wins:
  // the flag means "the json property", not "the complete procedure input"
  expect(await run(router, ['with-json-property', '--json', '123', '--other', 'x'])).toMatchInlineSnapshot(
    `"{"json":"123","other":"x"}"`,
  )
  // no cosmetic duplicate - the only --json in help is the schema-derived one
  expect(await run(router, ['with-json-property', '--help'])).toMatchInlineSnapshot(`
    "Usage: program with-json-property [options]

    Options:
      --json <string>
      --other [string]
      -h, --help        display help for command
    "
  `)
  // sibling commands without a json property still go JSON-only in the same invocation style
  expect(await run(router, ['sibling', '--json', '{"foo":"bar"}'])).toMatchInlineSnapshot(`"{"foo":"bar"}"`)
})
