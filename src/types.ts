import {type JsonSchema7Type} from 'zod-to-json-schema'
import {AnyRouter, CreateCallerFactoryLike, inferRouterContext} from './trpc-compat'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type TrpcCliParams<R extends AnyRouter> = {
  /** A tRPC router. Procedures will become CLI commands. */
  router: R
  /** Context to be supplied when invoking the router. */
  context?: inferRouterContext<R>
  /** @deprecated this is actually **removed** not deprecated; use `aliases` on each procedure `meta` instead */
  alias?: never // ((fullName: string, meta: {command: string; flags: Record<string, unknown>}) => string | undefined)
  /** @deprecated this is actually **removed** not deprecated; set `default: true` on the procedure `meta` instead */
  _default?: never // {procedure: Extract<keyof R['_def']['procedures'], string>}

  /** The `createCallerFactory` function from `@trpc/server`. Required when using trpc v11. */
  createCallerFactory?: CreateCallerFactoryLike
}
/**
 * Optional interface for describing procedures via meta - if your router conforms to this meta shape, it will contribute to the CLI help text.
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

/**
 * Slim reconstruction of an `omelette` instance. Hand-written here to avoid a hard dependency on `omelette` or its types.
 * Usually you will just pass in an `omelette` instance by doing something like
 *
 * ```ts
 * import omelette from 'omelette'
 * import {createCli} from 'trpc-cli'
 *
 * const cli = createCli({
 *   router: myRouter,
 *   completion: omelette('myprogram'),
 * })
 * ```
 *
 * Or it also accepts an async function that resolves to an `omelette` instance, so you can use dynamic import:
 *
 * ```ts
 * import {createCli} from 'trpc-cli'
 *
 * const cli = await createCli({
 *   router: myRouter,
 *   completion: () => import('omelette').then(omelette => omelette.default('myprogram')),
 * })
 * ```
 */
export interface OmeletteInstanceLike {
  on: (
    event: 'complete',
    callback: (
      fragment: string,
      params: {line: string; fragment: number; reply: (suggestions: string[]) => void},
    ) => void,
  ) => void
  init: () => void
  setupShellInitFile: () => void
  cleanupShellInitFile: () => void
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tree: (value: any) => this
}
