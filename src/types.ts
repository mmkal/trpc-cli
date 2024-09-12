import {type JsonSchema7Type} from 'zod-to-json-schema'
import {AnyRouter, inferRouterContext} from './trpc-compat'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type TrpcCliParams<R extends AnyRouter> = {
  /** A tRPC router. Procedures will become CLI commands. */
  router: R
  /** Context to be supplied when invoking the router. */
  context?: inferRouterContext<R>
  /**
   * A function that will be called for every flag, for every command. Used to provide single-character aliases for flags.
   * Return a single-character string to alias a flag to that character.
   * @param fullName The full-length name of the flag
   * @param meta Metadata about the command and flags. Includes the command name and all the other flags for the command (so you can avoid clashes you might get with `return fullName[0]`).
   * @returns A single-letter string to alias the flag to that character, or `void`/`undefined` to not alias the flag.
   */
  alias?: (fullName: string, meta: {command: string; flags: Record<string, unknown>}) => string | undefined
  /**
   * The name of the "default" command - this procedure will be run if no command is specified. Default value is `default`, if such a procedure exists. Otherwise there is no default procedure.
   * Set to `false` to disable the default command, even when there's a procedure named `'default'`.
   */
  default?: {
    procedure: keyof R['_def']['procedures']
  }
}
/**
 * Optional interface for describing procedures via meta - if your router conforms to this meta shape, it will contribute to the CLI help text.
 * Based on @see `import('cleye').HelpOptions`
 */

export interface TrpcCliMeta {
  /** Version of the script displayed in `--help` output. Use to avoid enabling `--version` flag. */
  version?: string
  /** Description of the script or command to display in `--help` output. */
  description?: string
  /** Usage code examples to display in `--help` output. */
  usage?: false | string | string[]
  /** Example code snippets to display in `--help` output. */
  examples?: string | string[]
}

export interface ParsedProcedure {
  /** positional parameters */
  parameters: string[]
  /** JSON Schema type describing the flags for the procedure */
  flagsSchema: JsonSchema7Type
  /**
   * Function for taking cleye parsed argv output and transforming it so it can be passed into the procedure
   * Needed because this function is where inspect the input schema(s) and determine how to map the argv to the input
   */
  getInput: (argv: {_: string[]; flags: Record<string, unknown>}) => unknown
}

export type Result<T> = {success: true; value: T} | {success: false; error: string}

/** A function that logs any inputs. e.g. `console.info` */
export type Log = (...args: unknown[]) => void

/**
 * A struct which has `info` and `error` functions for logging. Easiest example: `console`
 * But most loggers like pino, winston etc. have a similar interface.
 */
export interface Logger {
  info?: Log
  error?: Log
}
