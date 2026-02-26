import {AsyncLocalStorage} from 'node:async_hooks'

/**
 * Slim interface for a commander `Command` instance as exposed by trpc-cli's context.
 * Avoids coupling the public type surface to commander's types.
 * Cast to `import('commander').Command` if you need full access.
 */
export interface CliCommand {
  /** The command name (kebab-cased). */
  name: () => string
  /** The help text for this command. */
  helpInformation: () => string
  /** The parsed options for this command. */
  opts: () => Record<string, unknown>
  /** The parent command, if this is a subcommand. */
  parent: CliCommand | null
  /**
   * The argv for this command. On the root program, this is the full argv that was parsed
   * (equivalent to what you'd pass to `run({argv})`). On a leaf command, this is the
   * args specific to that command, excluding routing segments.
   */
  __argv?: string[]
}

export interface CliContextValue {
  /**
   * The root program. Access the full parsed argv via `program.__argv`,
   * or any other program-level APIs.
   */
  program: CliCommand
  /**
   * The leaf command for the procedure being invoked.
   * Useful for help text (`command.helpInformation()`), command name (`command.name()`),
   * the command-specific argv (`command.__argv`), etc.
   */
  command: CliCommand
}

const cliContextStorage = new AsyncLocalStorage<CliContextValue>()

/**
 * Get the current CLI context from within a procedure handler. This provides access to
 * the commander `Command` instances for both the root program and the specific command
 * being invoked.
 *
 * This function uses `AsyncLocalStorage` under the hood, so it works from anywhere in the
 * async call chain of a procedure handler - including middleware, nested function calls, etc.
 *
 * Returns `undefined` if called outside of a CLI procedure invocation (e.g. when the router
 * is used as a normal tRPC router in a server context).
 *
 * @example
 * ```ts
 * import {getCliContext} from 'trpc-cli'
 *
 * const myProcedure = t.procedure
 *   .input(z.object({verbose: z.boolean().optional()}))
 *   .query(({input}) => {
 *     const ctx = getCliContext()
 *     if (ctx) {
 *       console.log('Command name:', ctx.command.name())
 *       console.log('Help text:', ctx.command.helpInformation())
 *       console.log('Program argv:', ctx.program.__argv)
 *     }
 *   })
 * ```
 */
export function getCliContext(): CliContextValue | undefined {
  return cliContextStorage.getStore()
}

/** @internal */
export function runWithCliContext<T>(context: CliContextValue, fn: () => T): T {
  return cliContextStorage.run(context, fn)
}
