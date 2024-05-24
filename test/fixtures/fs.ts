import * as trpcServer from '@trpc/server'
import {z} from 'zod'
import {TrpcCliMeta, trpcCli} from '../../src'

const trpc = trpcServer.initTRPC.meta<TrpcCliMeta>().create()

const fakeFileSystem = getFakeFileSystem()

const router = trpc.router({
  copy: trpc.procedure
    .input(
      z.tuple([
        z.string().describe('Source path'), //
        z.string().nullish().describe('Destination path'),
        z.object({
          force: z.boolean().optional().default(false).describe('Overwrite destination if it exists'),
        }),
      ]),
    )
    .mutation(async ({input: [source, destination = `${source}.copy`, options]}) => {
      // ...copy logic...
      return {source, destination, options}
    }),
  diff: trpc.procedure
    .input(
      z.tuple([
        z.enum(['one', 'two', 'three', 'four']).describe('Base path'),
        z.enum(['one', 'two', 'three', 'four']).describe('Head path'),
        z.object({
          ignoreWhitespace: z.boolean().optional().default(false).describe('Ignore whitespace changes'),
          trim: z.boolean().optional().default(false).describe('Trim start/end whitespace'),
        }),
      ]),
    )
    .query(async ({input: [base, head, options]}) => {
      const [left, right] = [base, head].map(path => {
        let content = fakeFileSystem[path]
        if (options?.trim) content = content.trim()
        if (options?.ignoreWhitespace) content = content.replaceAll(/\s/g, '')
        return content
      })

      if (left === right) return null
      if (left.length !== right.length) return `base has length ${left.length} and head has length ${right.length}`
      const firstDiffIndex = left.split('').findIndex((char, i) => char !== right[i])
      return `base and head differ at index ${firstDiffIndex} (${JSON.stringify(left[firstDiffIndex])} !== ${JSON.stringify(right[firstDiffIndex])})`
    }),
})

function getFakeFileSystem(): Record<string, string> {
  return {
    one: 'a,b,c',
    two: 'a,b,c',
    three: 'x,y,z',
    four: 'x,y,z ',
  }
}

void trpcCli({router}).run()
