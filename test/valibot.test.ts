import * as trpcServer from '@trpc/server'
import {inspect} from 'util'
import * as v from 'valibot'
import {expect, test} from 'vitest'
import {createCli, TrpcCliMeta} from '../src'
import {run, snapshotSerializer} from './test-run'

expect.addSnapshotSerializer(snapshotSerializer)

const t = trpcServer.initTRPC.meta<TrpcCliMeta>().create()

// codegen:start {preset: custom, source: ./validation-library-codegen.ts, export: testSuite}
// NOTE: the below tests are ✨generated✨ based on the hand-written tests in ../zod3.test.ts
// But the zod types are expected to be replaced with equivalent types (written by hand).
// If you change anything other than `.input(...)` types, the linter will just undo your changes.

test('string input', async () => {
  const router = t.router({
    foo: t.procedure
      .input(v.string()) //
      .query(({input}) => JSON.stringify(input)),
  })

  expect(await run(router, ['foo', 'hello'])).toMatchInlineSnapshot('SNAPSHOT_PLACEHOLDER:0')
})

test('enum input', async () => {
  const router = t.router({
    foo: t.procedure
      .input(
        v.union([
          v.literal('aa'), // i want to comment on valibot specific stuff
          v.literal('bb'),
        ]),
      ) //
      .query(({input}) => JSON.stringify(input)),
  })

  expect(await run(router, ['foo', 'aa'])).toMatchInlineSnapshot(`""aa""`)
  await expect(run(router, ['foo', 'cc'])).rejects.toMatchInlineSnapshot('SNAPSHOT_PLACEHOLDER:1')
})
// codegen:end

test('valibot schemas to JSON schema', () => {
  // just a test to quickly see how valibot schemas are converted to JSON schema
  // honestly not a test of trpc-cli at all but useful for debugging
  const toJsonSchema = (schema: any) => {
    try {
      return require('@valibot/to-json-schema').toJsonSchema(schema, {errorMode: 'ignore'})
    } catch (e) {
      return e
    }
  }

  expect(toJsonSchema(v.optional(v.string()))).toMatchInlineSnapshot(`
    {
      "$schema": "http://json-schema.org/draft-07/schema#",
      "type": "string",
    }
  `)

  expect(
    toJsonSchema(
      v.union([
        v.string(),
        v.pipe(
          v.number(),
          v.integer(), //
        ),
      ]),
    ),
  ).toMatchInlineSnapshot(`
    {
      "$schema": "http://json-schema.org/draft-07/schema#",
      "anyOf": [
        {
          "type": "string",
        },
        {
          "type": "integer",
        },
      ],
    }
  `)

  expect(
    toJsonSchema(
      v.union([
        v.string(),
        v.pipe(
          v.number(),
          v.custom(n => Number.isInteger(n)), // note: avoid this - the resultant JSON schema doesn't know the number must be an integer
        ),
      ]),
    ),
  ).toMatchInlineSnapshot(`
    {
      "$schema": "http://json-schema.org/draft-07/schema#",
      "anyOf": [
        {
          "type": "string",
        },
        {
          "type": "number",
        },
      ],
    }
  `)

  expect(
    toJsonSchema(
      v.pipe(
        v.number(),
        v.custom(n => Number.isInteger(n)),
      ),
    ),
  ).toMatchInlineSnapshot(`
    {
      "$schema": "http://json-schema.org/draft-07/schema#",
      "type": "number",
    }
  `)

  expect(
    toJsonSchema(
      v.union([
        v.string(),
        v.pipe(
          v.number(),
          v.transform(n => `Roman numeral: ${'I'.repeat(n)}`),
        ),
      ]),
    ),
  ).toMatchInlineSnapshot(`
    {
      "$schema": "http://json-schema.org/draft-07/schema#",
      "anyOf": [
        {
          "type": "string",
        },
        {
          "type": "number",
        },
      ],
    }
  `)

  expect(toJsonSchema(v.object({foo: v.optional(v.string(), 'hi')}))).toMatchInlineSnapshot(`
    {
      "$schema": "http://json-schema.org/draft-07/schema#",
      "properties": {
        "foo": {
          "default": "hi",
          "type": "string",
        },
      },
      "required": [],
      "type": "object",
    }
  `)

  expect(toJsonSchema(v.pipe(v.string(), v.regex(/foo.*bar/)))).toMatchInlineSnapshot(`
    {
      "$schema": "http://json-schema.org/draft-07/schema#",
      "pattern": "foo.*bar",
      "type": "string",
    }
  `)

  expect(toJsonSchema(v.pipe(v.string(), v.description('a piece of text')))).toMatchInlineSnapshot(`
    {
      "$schema": "http://json-schema.org/draft-07/schema#",
      "description": "a piece of text",
      "type": "string",
    }
  `)

  expect(
    toJsonSchema(
      v.pipe(
        v.union([
          v.string(),
          v.pipe(
            v.number(),
            v.integer(), //
          ),
        ]),
        v.transform(u => ({u})),
      ),
    ),
  ).toMatchInlineSnapshot(`
    {
      "$schema": "http://json-schema.org/draft-07/schema#",
      "anyOf": [
        {
          "type": "string",
        },
        {
          "type": "integer",
        },
      ],
    }
  `)

  expect(
    toJsonSchema(
      v.array(
        v.pipe(
          v.number(),
          v.custom(n => Number.isInteger(n)),
        ),
      ),
    ),
  ).toMatchInlineSnapshot(`
    {
      "$schema": "http://json-schema.org/draft-07/schema#",
      "items": {
        "type": "number",
      },
      "type": "array",
    }
  `)

  expect(
    toJsonSchema(
      v.union([
        v.string(),
        v.pipe(
          v.pipe(
            v.number(),
            v.custom(n => Number.isInteger(n)),
          ),
          v.transform(n => `Roman numeral: ${'I'.repeat(n)}`),
        ),
      ]),
    ),
  ).toMatchInlineSnapshot(`
    {
      "$schema": "http://json-schema.org/draft-07/schema#",
      "anyOf": [
        {
          "type": "string",
        },
        {
          "type": "number",
        },
      ],
    }
  `)
})
