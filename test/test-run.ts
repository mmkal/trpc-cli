globalThis.require = require

import {expect} from 'vitest'
import {AnyRouter, FailedToExitError, TrpcCliParams, createCli} from '../src'
import {looksLikeInstanceof} from '../src/util'

export const run = <R extends AnyRouter>(router: R, argv: string[], {expectJsonInput = false} = {}) => {
  return runWith({router}, argv, {expectJsonInput})
}
export const runWith = async <R extends AnyRouter>(
  params: TrpcCliParams<R>,
  argv: string[],
  {expectJsonInput = false} = {},
): Promise<string> => {
  const cli = createCli(params)
  const logs = [] as unknown[][]
  const addLogs = (...args: unknown[]) => logs.push(args)
  const result: string = await cli
    .run({
      argv,
      logger: {info: addLogs, error: addLogs},
      process: {exit: _ => 0 as never},
    })
    .then(String)
    .catch(async e => {
      if (e instanceof FailedToExitError) {
        if (e.exitCode === 0 && (e.cause as any).message === '(outputHelp)') return logs[0][0] as string // should be the help text
        if (e.exitCode === 0) return e.cause as string
        // eslint-disable-next-line promise/no-nesting
        const help = argv.includes('--help') ? '' : await runWith(params, argv.concat(['--help'])).catch(String)
        const print = (obj: Record<string, string>) => {
          const lines = Object.entries(obj).map(([k, v]) => `<${k}>\n${v.trim()}\n</${k}>`)
          return lines.join('\n\n')
        }
        // add to the FailedToExitError message so it's easier to debug when tests fail
        e.message = print({argv: argv.join(' '), FailedToExitError: String(e), cause: String(e.cause), help})
      }
      throw e
    })

  // Usually when the result includes `--input [json]` it's because there's a bug in this library - we've failed to convert to json-schema
  // or failed to process some weird json-schema, meaning the cli just accepts one big json object. In these cases if the test tries to do
  // `mycli --foo bar` it'll fail with a message that includes `--input [json]` in the help text because it's expecting `--input '{"foo":"bar"}'`
  const hasJsonInput = result.includes('--input [json]')
  if (result.includes('--') && hasJsonInput !== expectJsonInput) {
    throw new Error(`${hasJsonInput ? 'Got' : 'Did not get'} --input [json]:\n\n${result}`)
  }
  return result
}

export const snapshotSerializer = {
  test: val => looksLikeInstanceof(val, Error),
  serialize(val, config, indentation, depth, refs, printer) {
    let topLine = `${val.constructor.name}: ${val.message}`
    if (val.constructor.name === 'FailedToExitError') topLine = `CLI exited with code ${val.exitCode}`

    if (!val.cause) return topLine
    indentation += '  '
    return `${topLine}\n${indentation}Caused by: ${printer(val.cause, config, indentation, depth + 1, refs)}`
      .split(/(---|Usage:)/)[0] // strip out the usage line and the --- line which is added for debugging when tests fail
      .trim()
  },
} satisfies Parameters<typeof expect.addSnapshotSerializer>[0]
