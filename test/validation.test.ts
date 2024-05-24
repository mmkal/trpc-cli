import {initTRPC} from '@trpc/server'
import {test, expect} from 'vitest'
import {z} from 'zod'
import {TrpcCliMeta, trpcCli} from '../src'

const t = initTRPC.meta<TrpcCliMeta>().create()

test('validation', async () => {
  const router = t.router({
    okTuple: t.procedure
      .input(z.tuple([z.string().describe('The first string'), z.string().describe('The second string')]))
      .query(() => 'ok'),
    tupleWithNumber: t.procedure
      .input(z.tuple([z.string(), z.number()])) //
      .query(() => 'ok'),
    tupleWithNumberThenObject: t.procedure
      .input(z.tuple([z.string(), z.number(), z.object({foo: z.string()})]))
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
      "tupleWithNumber": "Invalid input type [ZodString, ZodNumber]. Type following positionals must accept object inputs.",
      "tupleWithNumberThenObject": "Invalid input type [ZodString, ZodNumber, ZodObject]. Positional parameters must be strings.",
      "tupleWithObjectInTheMiddle": "Invalid input type [ZodString, ZodObject, ZodString]. Positional parameters must be strings.",
      "tupleWithRecord": "Invalid input type [ZodString, ZodRecord]. Type following positionals must accept object inputs.",
    }
  `)
})
