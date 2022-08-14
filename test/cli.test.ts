import {cliAdapter} from '../src'
import * as trpc from '@trpc/server'
import {z} from 'zod'
import * as arg from 'arg'
import {Procedure} from '@trpc/server/src/internals/procedure'

test('router', async () => {
  const sumRouter = trpc
    .router()
    .mutation('sum', {
      input: z.object({
        left: z.number(),
        right: z.number(),
      }),
      resolve: ({input}) => input.left + input.right,
    })
    .query('divide', {
      input: z.object({left: z.number(), right: z.number().refine(n => n !== 0)}),
      resolve: ({input}) => input.left / input.right,
    })

  const {run} = cliAdapter(sumRouter)

  expect(await run(['sum', '--left', '1.4', '--right', '4'])).toEqual(5.4)
  expect(await run(['divide', '--left', '8', '--right', '4'])).toEqual(2)
})
