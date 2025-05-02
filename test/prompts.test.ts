import {Command, Option} from 'commander'
import {expect, test, vi} from 'vitest'
import {AnyRouter, createCli, TrpcCliParams, TrpcCliRunParams, trpcServer, z} from '../src'

const runWith = async <R extends AnyRouter>(
  params: TrpcCliParams<R>,
  argv: string[],
  runParams: Omit<TrpcCliRunParams, 'argv'> = {},
): Promise<string> => {
  const cli = createCli(params)
  const logs = [] as unknown[][]
  const addLogs = (...args: unknown[]) => logs.push(args)
  const result: string = await cli
    .run({
      logger: {info: addLogs, error: addLogs},
      process: {exit: _ => 0 as never},
      ...runParams,
      argv,
    })
    .catch(e => {
      if (e.exitCode === 0 && e.cause.message === '(outputHelp)') return logs[0][0] // should be the help text
      if (e.exitCode === 0) return e.cause
      throw e
    })

  return result
}

test('custom prompter', async () => {
  const t = trpcServer.initTRPC.create()

  const router = t.router({
    create: t.procedure
      .meta({default: true})
      .input(
        z.object({
          projectName: z.string().describe('What will your project be called?').default('my-app'),
          language: z.enum(['typescript', 'javascript']).describe('What language will you be using?').optional(),
          packages: z
            .enum(['better-auth', 'pgkit', 'tailwind', 'trpc'])
            .array()
            .describe('What packages will you be using?'),
          gitInit: z.boolean().describe('Initialize a git repository?').default(true),
          packageManager: z
            .enum(['npm', 'yarn', 'pnpm'])
            .describe('What package manager will you be using?')
            .default('pnpm'),
          install: z.boolean().describe('Install dependencies?'),
        }),
      )
      .mutation(async ({input}) => JSON.stringify(input, null, 2)),
  })

  const result = await runWith({router}, ['create', '--package-manager', 'yarn'], {
    prompts: command => {
      // example of how you can customize prompts however you want - this one doesn't "prompt" at all, it uses silly rules to decide on values.
      return {
        setup: async ctx => {
          console.log('setup', ctx.inputs)
        },
        input: async (params, ctx) => {
          const commanderOptions = (command as Command).options.filter(o => o.name() === ctx.option?.name())
          if (commanderOptions.length === 1) {
            return commanderOptions[0].defaultValue + '-foo'
          }
          return `a value in response to: ${params.message}`
        },
        select: async (params, _ctx) => {
          const first = params.choices.at(-1)! // always choose the last
          return typeof first === 'string' ? first : first.value
        },
        confirm: async (params, ctx) => {
          if (ctx.option?.name() === 'git-init') return false
          return true
        },
        checkbox: async (params, _ctx) => {
          return params.choices.flatMap((c, i) => (i % 2 === 0 ? [c.value] : [])) // select every other option
        },
      }
    },
  })

  expect(result).toMatchInlineSnapshot(
    `
      "{
        "projectName": "a value in response to: [--project-name] What will your project be called?",
        "language": "javascript",
        "packages": [
          "better-auth",
          "tailwind"
        ],
        "gitInit": true,
        "packageManager": "yarn",
        "install": true
      }"
    `,
  )
})
