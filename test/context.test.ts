import {initTRPC} from '@trpc/server'
import {expect, test} from 'vitest'
import {z} from 'zod/v4'
import {createCli, getCliContext, TrpcCliMeta} from '../src/index.js'
import {looksLikeInstanceof} from '../src/util.js'

const t = initTRPC.meta<TrpcCliMeta>().create()

expect.addSnapshotSerializer({
  test: (val): val is {name: () => string; __argv?: string[]} =>
    looksLikeInstanceof(val, 'Command') && typeof (val as any).name === 'function',
  serialize(val, config, indentation, depth, refs, printer) {
    return printer({name: val.name(), __argv: val.__argv}, config, indentation, depth, refs)
  },
})

test('getCliContext returns program and command inside a procedure', async () => {
  let captured: ReturnType<typeof getCliContext>

  const router = t.router({
    greet: t.procedure
      .meta({description: 'Say hello to someone'})
      .input(z.object({name: z.string()}))
      .query(({input}) => {
        captured = getCliContext()
        return `Hello, ${input.name}!`
      }),
  })

  const cli = createCli({router})
  await cli
    .run({
      argv: ['greet', '--name', 'World'],
      process: {exit: () => void 0 as never},
      logger: {info: () => {}, error: () => {}},
    })
    .catch(() => {})

  expect(captured).toMatchInlineSnapshot(`
    {
      "command": {
        "__argv": [
          "--name",
          "World",
        ],
        "name": "greet",
      },
      "program": {
        "__argv": [
          "greet",
          "--name",
          "World",
        ],
        "name": "program",
      },
    }
  `)
})

test('getCliContext returns undefined outside of a procedure', () => {
  expect(getCliContext()).toMatchInlineSnapshot(`undefined`)
})

test('getCliContext works in middleware', async () => {
  let capturedInMiddleware: ReturnType<typeof getCliContext>

  const middleware = t.middleware(async ({next}) => {
    capturedInMiddleware = getCliContext()
    return next()
  })

  const router = t.router({
    greet: t.procedure
      .use(middleware)
      .input(z.object({name: z.string()}))
      .query(({input}) => `Hello, ${input.name}!`),
  })

  const cli = createCli({router})
  await cli
    .run({
      argv: ['greet', '--name', 'World'],
      process: {exit: () => void 0 as never},
      logger: {info: () => {}, error: () => {}},
    })
    .catch(() => {})

  expect(capturedInMiddleware).toMatchInlineSnapshot(`
    {
      "command": {
        "__argv": [
          "--name",
          "World",
        ],
        "name": "greet",
      },
      "program": {
        "__argv": [
          "greet",
          "--name",
          "World",
        ],
        "name": "program",
      },
    }
  `)
})

test('getCliContext works in nested async calls', async () => {
  let capturedAsync: ReturnType<typeof getCliContext>

  async function nestedHelper() {
    await new Promise(resolve => setTimeout(resolve, 10))
    capturedAsync = getCliContext()
  }

  const router = t.router({
    greet: t.procedure.input(z.object({name: z.string()})).query(async ({input}) => {
      await nestedHelper()
      return `Hello, ${input.name}!`
    }),
  })

  const cli = createCli({router})
  await cli
    .run({
      argv: ['greet', '--name', 'World'],
      process: {exit: () => void 0 as never},
      logger: {info: () => {}, error: () => {}},
    })
    .catch(() => {})

  expect(capturedAsync).toMatchInlineSnapshot(`
    {
      "command": {
        "__argv": [
          "--name",
          "World",
        ],
        "name": "greet",
      },
      "program": {
        "__argv": [
          "greet",
          "--name",
          "World",
        ],
        "name": "program",
      },
    }
  `)
})

test('getCliContext with description and examples', async () => {
  let captured: ReturnType<typeof getCliContext>

  const router = t.router({
    divide: t.procedure
      .meta({
        description: 'Divide two numbers',
        examples: 'divide --left 8 --right 4',
      })
      .input(
        z.object({
          left: z.number().describe('numerator'),
          right: z.number().describe('denominator'),
        }),
      )
      .query(({input}) => {
        captured = getCliContext()
        return input.left / input.right
      }),
  })

  const cli = createCli({router})
  await cli
    .run({
      argv: ['divide', '--left', '8', '--right', '4'],
      process: {exit: () => void 0 as never},
      logger: {info: () => {}, error: () => {}},
    })
    .catch(() => {})

  expect(captured).toMatchInlineSnapshot(`
    {
      "command": {
        "__argv": [
          "--left",
          "8",
          "--right",
          "4",
        ],
        "name": "divide",
      },
      "program": {
        "__argv": [
          "divide",
          "--left",
          "8",
          "--right",
          "4",
        ],
        "name": "program",
      },
    }
  `)
})

test('getCliContext with nested router commands', async () => {
  let captured: ReturnType<typeof getCliContext>

  const router = t.router({
    math: t.router({
      add: t.procedure
        .meta({description: 'Add two numbers'})
        .input(z.object({a: z.number(), b: z.number()}))
        .query(({input}) => {
          captured = getCliContext()
          return input.a + input.b
        }),
    }),
  })

  const cli = createCli({router})
  await cli
    .run({
      argv: ['math', 'add', '--a', '2', '--b', '3'],
      process: {exit: () => void 0 as never},
      logger: {info: () => {}, error: () => {}},
    })
    .catch(() => {})

  expect(captured).toMatchInlineSnapshot(`
    {
      "command": {
        "__argv": [
          "--a",
          "2",
          "--b",
          "3",
        ],
        "name": "add",
      },
      "program": {
        "__argv": [
          "math",
          "add",
          "--a",
          "2",
          "--b",
          "3",
        ],
        "name": "program",
      },
    }
  `)
})

test('getCliContext with deeply nested router commands', async () => {
  let captured: ReturnType<typeof getCliContext>

  const router = t.router({
    deeply: t.router({
      nested: t.router({
        cmd: t.procedure
          .meta({description: 'A deeply nested command'})
          .input(z.object({x: z.string()}))
          .query(({input}) => {
            captured = getCliContext()
            return input.x
          }),
      }),
    }),
  })

  const cli = createCli({router})
  await cli
    .run({
      argv: ['deeply', 'nested', 'cmd', '--x', 'hello'],
      process: {exit: () => void 0 as never},
      logger: {info: () => {}, error: () => {}},
    })
    .catch(() => {})

  expect(captured).toMatchInlineSnapshot(`
    {
      "command": {
        "__argv": [
          "--x",
          "hello",
        ],
        "name": "cmd",
      },
      "program": {
        "__argv": [
          "deeply",
          "nested",
          "cmd",
          "--x",
          "hello",
        ],
        "name": "program",
      },
    }
  `)
})

test('getCliContext with positional args', async () => {
  let captured: ReturnType<typeof getCliContext>

  const router = t.router({
    greet: t.procedure
      .input(z.tuple([z.string().describe('name'), z.object({loud: z.boolean().optional()})]))
      .query(({input}) => {
        captured = getCliContext()
        return input
      }),
  })

  const cli = createCli({router})
  await cli
    .run({
      argv: ['greet', 'Alice', '--loud'],
      process: {exit: () => void 0 as never},
      logger: {info: () => {}, error: () => {}},
    })
    .catch(() => {})

  expect(captured).toMatchInlineSnapshot(`
    {
      "command": {
        "__argv": [
          "Alice",
          "--loud",
        ],
        "name": "greet",
      },
      "program": {
        "__argv": [
          "greet",
          "Alice",
          "--loud",
        ],
        "name": "program",
      },
    }
  `)
})

test('getCliContext when using process.argv', async () => {
  let captured: ReturnType<typeof getCliContext>

  const router = t.router({
    greet: t.procedure.input(z.object({name: z.string()})).query(({input}) => {
      captured = getCliContext()
      return `Hello, ${input.name}!`
    }),
  })

  const originalArgv = process.argv
  try {
    process.argv = ['node', 'script.js', 'greet', '--name', 'Test']
    const cli = createCli({router})
    await cli
      .run({
        process: {exit: () => void 0 as never},
        logger: {info: () => {}, error: () => {}},
      })
      .catch(() => {})

    expect(captured).toMatchInlineSnapshot(`
      {
        "command": {
          "__argv": [
            "--name",
            "Test",
          ],
          "name": "greet",
        },
        "program": {
          "__argv": [
            "greet",
            "--name",
            "Test",
          ],
          "name": "script",
        },
      }
    `)
  } finally {
    process.argv = originalArgv
  }
})
