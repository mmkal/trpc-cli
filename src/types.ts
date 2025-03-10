import {type JsonSchema7Type} from 'zod-to-json-schema'
import {AnyRouter, CreateCallerFactoryLike, inferRouterContext} from './trpc-compat'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type TrpcCliParams<R extends AnyRouter> = {
  /** A tRPC router. Procedures will become CLI commands. */
  router: R
  /** Context to be supplied when invoking the router. */
  context?: inferRouterContext<R>
  /**
   * @deprecated use `aliases` on each procedure `meta` instead
   * A function that will be called for every flag, for every command. Used to provide single-character aliases for flags.
   * Return a single-character string to alias a flag to that character.
   * @param fullName The full-length name of the flag
   * @param meta Metadata about the command and flags. Includes the command name and all the other flags for the command (so you can avoid clashes you might get with `return fullName[0]`).
   * @returns A single-letter string to alias the flag to that character, or `void`/`undefined` to not alias the flag.
   */
  alias?: (fullName: string, meta: {command: string; flags: Record<string, unknown>}) => string | undefined
  /**
   * @deprecated
   * The name of the "default" command - this procedure will be run if no command is specified. Default value is `default`, if such a procedure exists. Otherwise there is no default procedure.
   * Set to `false` to disable the default command, even when there's a procedure named `'default'`.
   */
  _default?: {
    procedure: Extract<keyof R['_def']['procedures'], string>
  }

  /** The `createCallerFactory` function from `@trpc/server`. Required when using trpc v11. */
  createCallerFactory?: CreateCallerFactoryLike
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
  /** If true, this command will be run if no command is specified. */
  default?: boolean
  aliases?: {
    /** Aliases for the command. Note: take care to avoid conflicts with other commands. */
    command?: string[]
    /** Aliases for the flags. Note: take care to avoid conflicts with other flags. An error will be thrown if an alias is defined for a non-existent flag. */
    flags?: Record<string, string>
  }
  /** Sub-property for the CLI meta. If present, will take precedence over the top-level meta, to avoid conflicts with other tools. */
  cliMeta?: TrpcCliMeta
}

export interface ParsedProcedure {
  positionalParameters: Array<{
    name: string
    description: string
    type: 'string' | 'number' | 'boolean'
    required: boolean
    array: boolean
  }>
  /** positional parameters */
  parameters: string[]
  /** JSON Schema type describing the flags for the procedure */
  flagsSchema: JsonSchema7Type
  /**
   * Function for taking commander parsed argv output and transforming it so it can be passed into the procedure.
   * Needed because this function is where inspect the input schema(s) and determine how to map the argv to the input
   */
  getInput: (argv: {positionalValues: Array<string | string[]>; flags: Record<string, unknown>}) => unknown
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
