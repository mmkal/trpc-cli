#!/usr/bin/env node
import {createCli} from '.'
import {Command} from 'commander'
import * as path from 'path'
import {Trpc11RouterLike} from './trpc-compat'

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

program.action(async () => {
  const [filepath, ...argv] = program.args
  console.log({filepath, argv, opts: program.opts()})
  if (filepath === '-h' || filepath === '--help') {
    program.help()
    return
  }
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  const options = program.opts() as {export?: string; require?: string}
  // for (const)
  options.require?.split(',')?.forEach(require)

  const fullpath = path.resolve(process.cwd(), filepath)
  const importedModule = (await import(fullpath)) as {}
  let router: Trpc11RouterLike
  const isTrpcRouterLike = (value: unknown): value is Trpc11RouterLike =>
    Boolean((value as Trpc11RouterLike)?._def?.procedures)
  if (options.export) {
    router = (importedModule as {[key: string]: Trpc11RouterLike})[options.export]
    if (!isTrpcRouterLike(router)) {
      throw new Error(`Expected a trpc router in ${filepath}.${options.export}, got ${typeof router}`)
    }
  } else if (isTrpcRouterLike(importedModule)) {
    router = importedModule
  } else {
    const routerExports = Object.values(importedModule).filter(isTrpcRouterLike)
    if (routerExports.length !== 1) {
      const defaultExport = (importedModule as {default?: {default?: {}}})?.default?.default
      if (defaultExport && isTrpcRouterLike(defaultExport)) {
        router = defaultExport
      } else {
        throw new Error(
          `Expected exactly one trpc router in ${filepath}, found ${routerExports.length}. Exports: ${Object.keys(importedModule).join(', ')}`,
        )
      }
    }
    router = routerExports[0]
  }

  const cli = createCli({router})
  await cli.run({argv})
})

// const t = initTRPC.meta<TrpcCliMeta>().create()

// const trpcCliRouter = t.router({
//   run: t.procedure
//     .meta({
//       description: 'Run an existing trpc router as a CLI',
//       default: true,
//     })
//     .input(
//       z.tuple([
//         z.string().describe('filepath of module with trpc router'),
//         z.object({
//           export: z
//             .string()
//             .optional()
//             .describe(
//               'The name of the export to use from the module. If not provided, all exports will be checked for a trpc router.',
//             ),
//         }),
//       ]),
//     )
//     .mutation(async ({input: [filepath, options]}) => {
//       const fullpath = path.resolve(process.cwd(), filepath)
//       const importedModule = (await import(fullpath)) as {}
//       let router: Trpc11RouterLike
//       const isTrpcRouterLike = (value: unknown): value is Trpc11RouterLike =>
//         Boolean((value as Trpc11RouterLike)?._def?.procedures)
//       if (options.export) {
//         router = (importedModule as {[key: string]: Trpc11RouterLike})[options.export]
//         if (!isTrpcRouterLike(router)) {
//           throw new Error(`Expected a trpc router in ${filepath}.${options.export}, got ${typeof router}`)
//         }
//       } else if (isTrpcRouterLike(importedModule)) {
//         router = importedModule
//       } else {
//         const routerExports = Object.values(importedModule).filter(isTrpcRouterLike)
//         if (routerExports.length !== 1) {
//           throw new Error(`Expected exactly one trpc router in ${filepath}, found ${routerExports.length}`)
//         }
//         router = routerExports[0]
//       }

//       const cli = createCli({router})
//       await cli.run()
//     }),
// })

// const trpcCli = createCli({router: trpcCliRouter})

// void trpcCli.run()

program.parse(process.argv)
