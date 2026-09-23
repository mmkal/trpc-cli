/**
 * Validation issues from the input schema are reported against the CLI argument or option they came from, worded
 * like commander's own parse errors, instead of as `→ at [0]`-style paths into the procedure input. The same
 * wording applies to tRPC, oRPC and norpc routers (module mode builds norpc routers - see
 * ./zod-function-module-commands.test.ts).
 */
import {os} from '@orpc/server'
import {initTRPC} from '@trpc/server'
import {expect, test} from 'vitest'
import {z} from 'zod/v4'
import {t as norpc} from '../src/norpc.js'
import {run, runWith, snapshotSerializer} from './test-run.js'

expect.addSnapshotSerializer(snapshotSerializer)

const t = initTRPC.create()

const checkHealthInput = z.tuple([
  z
    .url()
    .refine(url => url.startsWith('https://'), 'secure only pls')
    .describe('url'),
  z.object({timeout: z.number().int().positive().optional().describe('give up after this many milliseconds')}),
])

test('positional argument and option issues name the argument/option, like commander parse errors', async () => {
  const router = t.router({
    checkHealth: t.procedure
      .input(checkHealthInput)
      .query(({input: [url, options]}) => `GET ${url}/health (timeout ${options.timeout || 'none'})`),
  })

  expect(await run(router, ['check-health', 'https://example.com'])).toMatchInlineSnapshot(`"GET https://example.com/health (timeout none)"`)
  await expect(run(router, ['check-health', 'http://example.com'])).rejects.toMatchInlineSnapshot(`
    CLI exited with code 1
      Caused by: CliValidationError: error: command-argument value 'http://example.com' is invalid for argument 'url'. secure only pls
  `)
  await expect(run(router, ['check-health', 'https://example.com', '--timeout', '0'])).rejects.toMatchInlineSnapshot(`
    CLI exited with code 1
      Caused by: CliValidationError: error: option '--timeout [integer]' argument '0' is invalid. Too small: expected number to be >0
  `)
  await expect(run(router, ['check-health', 'http://example.com', '--timeout', '1.5'])).rejects.toMatchInlineSnapshot(`
    CLI exited with code 1
      Caused by: CliValidationError: error: command-argument value 'http://example.com' is invalid for argument 'url'. secure only pls
    error: option '--timeout [integer]' argument '1.5' is invalid. Invalid input: expected int, received number
  `)
})

test('object properties marked positional are reported as arguments', async () => {
  const router = t.router({
    greet: t.procedure
      .input(z.object({name: z.string().min(3).meta({positional: true}), shout: z.boolean().optional()}))
      .query(({input}) => `hello ${input.shout ? input.name.toUpperCase() : input.name}`),
  })

  expect(await run(router, ['greet', 'bob', '--shout'])).toMatchInlineSnapshot(`"hello BOB"`)
  await expect(run(router, ['greet', 'bo'])).rejects.toMatchInlineSnapshot(`
    CLI exited with code 1
      Caused by: CliValidationError: error: command-argument value 'bo' is invalid for argument 'name'. Too small: expected string to have >=3 characters
  `)
})

test('issues that do not map to one argument or option fall back to a plain issue line', async () => {
  const router = t.router({
    range: t.procedure
      .input(z.object({from: z.number(), to: z.number()}).refine(r => r.from < r.to, 'from must be less than to'))
      .query(({input}) => `${input.from}..${input.to}`),
  })

  await expect(run(router, ['range', '--from', '5', '--to', '1'])).rejects.toMatchInlineSnapshot(`
    CLI exited with code 1
      Caused by: CliValidationError: ✖ from must be less than to
  `)
})

test('a schema error thrown inside the handler is a crash, not a bad CLI input', async () => {
  const router = t.router({
    parse: t.procedure.input(z.object({value: z.string()})).query(({input}) => z.number().parse(input.value)),
  })

  await expect(run(router, ['parse', '--value', 'x'])).rejects.toMatchInlineSnapshot(`
    CLI exited with code 1
      Caused by: ZodError: [
      {
        "expected": "number",
        "code": "invalid_type",
        "path": [],
        "message": "Invalid input: expected number, received string"
      }
    ]
  `)
})

test('oRPC routers get the same wording', async () => {
  const router = os.router({
    checkHealth: os
      .input(checkHealthInput)
      .handler(({input: [url, options]}) => `GET ${url}/health (timeout ${options.timeout || 'none'})`),
  })

  await expect(run(router, ['check-health', 'http://example.com'])).rejects.toMatchInlineSnapshot(`
    CLI exited with code 1
      Caused by: CliValidationError: error: command-argument value 'http://example.com' is invalid for argument 'url'. secure only pls
  `)
  await expect(run(router, ['check-health', 'https://example.com', '--timeout', '0'])).rejects.toMatchInlineSnapshot(`
    CLI exited with code 1
      Caused by: CliValidationError: error: option '--timeout [integer]' argument '0' is invalid. Too small: expected number to be >0
  `)
})

test('norpc routers get the same wording', async () => {
  const router = norpc.router({
    checkHealth: norpc.procedure
      .input(checkHealthInput)
      .handler(({input: [url, options]}) => `GET ${url}/health (timeout ${options.timeout || 'none'})`),
    parse: norpc.procedure.input(z.object({value: z.string()})).handler(({input}) => z.number().parse(input.value)),
  })

  await expect(run(router, ['check-health', 'http://example.com'])).rejects.toMatchInlineSnapshot(`
    CLI exited with code 1
      Caused by: CliValidationError: error: command-argument value 'http://example.com' is invalid for argument 'url'. secure only pls
  `)
  await expect(run(router, ['check-health', 'https://example.com', '--timeout', '0'])).rejects.toMatchInlineSnapshot(`
    CLI exited with code 1
      Caused by: CliValidationError: error: option '--timeout [integer]' argument '0' is invalid. Too small: expected number to be >0
  `)
  // not misreported as bad CLI input: the handler threw, the input was fine
  await expect(run(router, ['parse', '--value', 'x'])).rejects.toMatchInlineSnapshot(`
    CLI exited with code 1
      Caused by: ZodError: [
      {
        "expected": "number",
        "code": "invalid_type",
        "path": [],
        "message": "Invalid input: expected number, received string"
      }
    ]
  `)
})

test('in --json mode, issues point into the --json option value', async () => {
  const router = t.router({
    checkHealth: t.procedure.input(checkHealthInput).query(({input: [url]}) => url),
  })

  await expect(
    runWith({router, jsonInput: 'always'}, ['check-health', '--json', '["http://example.com", {"timeout": 0}]']),
  ).rejects.toMatchInlineSnapshot(`
    CLI exited with code 1
      Caused by: CliValidationError: error: option '--json <json>' argument 'http://example.com' is invalid. secure only pls
    error: option '--json <json>' argument '{"timeout":0}' is invalid. Too small: expected number to be >0 → at timeout
  `)
})
