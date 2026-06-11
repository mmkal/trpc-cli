/**
 * Zero-peer-dependency usage: the built-in norpc router + vendored typebox.
 * Note what ISN'T imported here: no zod, no @trpc/server, no @orpc/server -
 * `trpc-cli` and `trpc-cli/typebox` are enough to build a fully working CLI.
 */
import {expect, test} from 'vitest'
import {t} from '../src/index.js'
import Type from '../src/typebox/index.js'
import {run, snapshotSerializer} from './test-run.js'

expect.addSnapshotSerializer(snapshotSerializer)

const router = t.router({
  greet: t.procedure
    .input(
      Type.Script(`{
        /** a message to say hello to new users */
        greeting: string
        /** make it loud */
        shout?: boolean
      }`),
    )
    .query(({input}) => (input.shout ? input.greeting.toUpperCase() + '!!!' : input.greeting)),
  add: t.procedure
    .input(Type.Tuple([Type.Number(), Type.Number()])) //
    .query(({input}) => input[0] + input[1]),
})

test('norpc + typebox CLI works with no peer dependencies', async () => {
  expect(await run(router, ['greet', '--greeting', 'hi'])).toMatchInlineSnapshot(`"hi"`)
  expect(await run(router, ['greet', '--greeting', 'hi', '--shout'])).toMatchInlineSnapshot(`"HI!!!"`)
  expect(await run(router, ['add', '2', '3'])).toMatchInlineSnapshot(`"5"`)
})

test('jsdoc descriptions show up in help', async () => {
  const help = await run(router, ['greet', '--help'])
  expect(help).toContain('a message to say hello to new users')
  expect(help).toContain('make it loud')
})

test('validation failures come from the typebox validator', async () => {
  await expect(run(router, ['greet', '--greeting', 'hi', '--shout', 'maybe'])).rejects.toMatchInlineSnapshot(
    `
    CLI exited with code 1
      Caused by: Error: Invalid input: ✖ must be boolean → at shout
  `,
  )
})
