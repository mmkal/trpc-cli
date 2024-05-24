import {initTRPC} from '@trpc/server'
import {test, expect} from 'vitest'
import {z} from 'zod'
import {TrpcCliMeta, trpcCli} from '../src'

const t = initTRPC.meta<TrpcCliMeta>().create()

test('validation', async () => {
  const router = t.router({
    tupleOfStrings: t.procedure
      .input(z.tuple([z.string().describe('The first string'), z.string().describe('The second string')]))
      .query(() => 'ok'),
    tupleWithBoolean: t.procedure
      .input(z.tuple([z.string(), z.boolean()])) //
      .query(() => 'ok'),
    tupleWithBooleanThenObject: t.procedure
      .input(z.tuple([z.string(), z.boolean(), z.object({foo: z.string()})]))
      .query(() => 'ok'),
    tupleWithObjectInTheMiddle: t.procedure
      .input(z.tuple([z.string(), z.object({foo: z.string()}), z.string()]))
      .query(() => 'ok'),
    tupleWithRecord: t.procedure
      .input(z.tuple([z.string(), z.record(z.string())])) //
      .query(() => 'ok'),
  })
  const cli = trpcCli({router})

  expect(cli.ignoredProcedures).toMatchInlineSnapshot(`
    {
      "tupleWithBoolean": "Invalid input type [ZodString, ZodBoolean]. The last type must accept object inputs.",
      "tupleWithBooleanThenObject": "Invalid input type [ZodString, ZodBoolean, ZodObject]. Positional parameters must be strings or numbers.",
      "tupleWithObjectInTheMiddle": "Invalid input type [ZodString, ZodObject, ZodString]. Positional parameters must be strings or numbers.",
      "tupleWithRecord": "Invalid input type [ZodString, ZodRecord]. The last type must accept object inputs.",
    }
  `)
})
