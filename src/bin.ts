#!/usr/bin/env node
import {createCli} from './index.js'
import {Command} from 'commander'
import * as path from 'path'
import {isOrpcRouter, Trpc11RouterLike} from './trpc-compat.js'

const program = new Command('trpc-cli')

program.allowExcessArguments()
program.allowUnknownOption()
program.enablePositionalOptions()
program.passThroughOptions()
program.helpOption(false)

program.argument('filepath', 'The filepath of the module with the trpc router')

program.option(
  '-e, --export [export]',
  'The name of the export to use from the module. If not provided, all exports will be checked for a trpc router.',
)
program.option(
  '-r, --require [module]',
  'A module (or comma-separated modules) to require before running the cli. Can be used to pass in options for the trpc router. e.g. --require dotenv/config',
)
program.option(
  '-i, --import [module]',
  'A module (or comma-separated modules) to import before running the cli. Can be used to pass in options for the trpc router. e.g. --import tsx/esm',
)

program.action(async () => {
  const [filepath, ...argv] = program.args
  if (filepath === '-h' || filepath === '--help') {
    program.help()
    return
  }
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  const options = program.opts() as {export?: string; require?: string; import?: string}
  for (const r of options.require?.split(',') || []) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require(r)
  }
  for (const m of options.import?.split(',') || []) {
    await import(m)
  }

  if (!options.require && !options.import) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('tsx/cjs')
      // @ts-expect-error - this might not be available, that's why we're catching
      await import('tsx/esm')
    } catch {
      // don't worry
    }
  }

  const fullpath = path.resolve(process.cwd(), filepath)
  let importedModule = (await import(fullpath)) as Record<string, unknown>
  while ('module.exports' in importedModule && importedModule?.['module.exports'] !== importedModule) {
    // this is a cjs-like module, possibly what tsx gives us
    importedModule = importedModule?.['module.exports'] as never
  }
  while ('default' in importedModule && importedModule?.default !== importedModule) {
    // depending on how it's loaded we can end up with weird stuff like `{default: {default: {myRouter: ...}}}`
    importedModule = importedModule?.default as never
  }
  let router: Trpc11RouterLike
  const looksLikeARouter = (value: unknown): value is Trpc11RouterLike =>
    Boolean((value as Trpc11RouterLike)?._def?.procedures) || isOrpcRouter(value as never)
  if (options.export) {
    router = (importedModule as {[key: string]: Trpc11RouterLike})[options.export]
    if (!looksLikeARouter(router)) {
      throw new Error(`Expected a trpc router in ${filepath}.${options.export}, got ${typeof router}`)
    }
  } else {
    const exports = Object.values(importedModule)
    const routerExports = exports.filter(looksLikeARouter)
    if (routerExports.length === 1) {
      router = routerExports[0]
    } else if (looksLikeARouter(importedModule)) {
      router = importedModule
    } else {
      throw new Error(
        `Expected exactly one trpc router in ${filepath}, found ${routerExports.length}. Exports: ${Object.keys(importedModule).join(', ')}`,
      )
    }
  }

  const cli = createCli({router})
  await cli.run({argv})
})

program.parse(process.argv)
