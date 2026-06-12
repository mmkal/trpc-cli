#!/usr/bin/env node
import {createCli} from './index.js'
import * as path from 'path'
import {yamlTableConsoleLogger} from './logging.js'

const [filepath, ...argv] = process.argv.slice(2)

if (!filepath || filepath === '--help' || filepath === '-h') {
  // eslint-disable-next-line no-console
  console.log(
    [
      'Usage: trpc-cli <module> [command] [args...]',
      '',
      'Runs a TypeScript/JavaScript module of plain exported functions as a CLI (experimental).',
      'Each exported function becomes a command: leading string/number/boolean parameters become',
      'positional arguments, a trailing object parameter becomes flags, and jsdoc comments become',
      'help text. Every command also accepts its full input as `--json <json>`.',
      '',
      'Example:',
      '  // commands.ts',
      '  /** add a package to the dependencies */',
      '  export async function add(packageName: string, options?: {dev?: boolean}) {',
      '    // ...',
      '  }',
      '',
      '  trpc-cli ./commands.ts add left-pad --dev',
      '',
      'For `.ts` modules, run under tsx, bun, deno, or node >=22.18 (which strip types natively).',
      'To build a CLI from a trpc/orpc router, use the `createCli` export instead of this bin script.',
    ].join('\n'),
  )
  process.exit(filepath ? 0 : 1)
}

const cli = createCli({
  module: filepath,
  name: path.basename(filepath).replace(/\.[^.]+$/, ''),
  jsonInput: 'auto',
})

void cli.run({argv, logger: yamlTableConsoleLogger})
