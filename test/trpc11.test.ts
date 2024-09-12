import {initTRPC} from 'trpcserver11'
import {expect, test} from 'vitest'
import {createCli, z} from '../src'

test('can create cli from trpc11', () => {
  const t = initTRPC.create()

  const router = t.router({
    add: t.procedure
      .input(z.tuple([z.number(), z.number()])) //
      .mutation(({input}) => {
        return input[0] + input[1]
      }),
  })

  const cli = createCli({router})

  expect(cli).toBeDefined()
})
