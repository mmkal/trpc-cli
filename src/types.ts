import {Router, inferRouterContext} from '@trpc/server'
import {type JsonSchema7Type} from 'zod-to-json-schema'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type TrpcCliParams<R extends Router<any>> = {
  router: R
  context?: inferRouterContext<R>
  alias?: (fullName: string, meta: {command: string; flags: Record<string, unknown>}) => string | undefined
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
  getInput: (argv: {_: string[]; flags: {}}) => unknown
}

export type Result<T> = {success: true; value: T} | {success: false; error: string}
