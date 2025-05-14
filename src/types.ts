import type {JSONSchema7} from 'json-schema'
import {type JsonSchema7Type} from 'zod-to-json-schema'
import {AnyRouter, CreateCallerFactoryLike, inferRouterContext} from './trpc-compat'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface TrpcCliParams<R extends AnyRouter> extends Dependencies {
  /** A tRPC router. Procedures will become CLI commands. */
  router: R
  /** Context to be supplied when invoking the router. */
  context?: inferRouterContext<R>
  /** @deprecated this is actually **removed** not deprecated; use `aliases` on each procedure `meta` instead */
  alias?: never // ((fullName: string, meta: {command: string; flags: Record<string, unknown>}) => string | undefined)
  /** @deprecated this is actually **removed** not deprecated; set `default: true` on the procedure `meta` instead */
  _default?: never // {procedure: Extract<keyof R['_def']['procedures'], string>}

  /** The `@trpc/server` module to use for calling procedures. Required when using trpc v10. */
  // createCallerFactory?: CreateCallerFactoryLike
  trpcServer?: TrpcServerModuleLike | Promise<TrpcServerModuleLike>
}

/** Rough shape of the `@trpc/server` (v10) module. Needed to pass in to `createCli` when using trpc v10. */
export type TrpcServerModuleLike = {
  initTRPC: {create: () => {createCallerFactory: CreateCallerFactoryLike<{}>}}
}

/**
 * Optional interface for describing procedures via meta - if your router conforms to this meta shape, it will contribute to the CLI help text.
 */

export interface TrpcCliMeta {
  /** Version of the script displayed in `--help` output. Use to avoid enabling `--version` option. */
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
    /** Aliases for the options. Note: take care to avoid conflicts with other options. An error will be thrown if an alias is defined for a non-existent option. */
    options?: Record<string, string>
  }
  /** If true, will use a single CLI option expect the entire input to be parsed in as JSON, e.g. `--input '{"foo": "bar"}`. Can be useful to opt out of the default mapping of input schemas to CLI options. */
  jsonInput?: boolean
  /** Sub-property for the CLI meta. If present, will take precedence over the top-level meta, to avoid conflicts with other tools. */
  cliMeta?: TrpcCliMeta
}

export interface ParsedProcedure {
  positionalParameters: Array<{
    name: string
    description: string
    type: 'string' | 'number' | 'boolean' | (string & {})
    required: boolean
    array: boolean
  }>
  /** JSON Schema type describing the flags for the procedure */
  optionsJsonSchema: JsonSchema7Type
  /**
   * Function for taking parsed argv output and transforming it so it can be passed into the procedure.
   * Needed because this function is where inspect the input schema(s) and determine how to map the argv to the input
   */
  getPojoInput: (argv: {positionalValues: Array<string | string[]>; options: Record<string, unknown>}) => unknown
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

export type InquirerPromptOptions = {
  message: string
  required?: boolean
  validate?: (input: string) => boolean | string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  default?: any
}

/** looks like the `@inquirer/prompts` package */
export type InquirerPromptsLike = {
  input: (params: InquirerPromptOptions) => Promise<string>
  confirm: (params: InquirerPromptOptions) => Promise<boolean>
}

/** looks like the `prompts` package */
export type PromptsLike = {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  prompt: Function
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  inject: Function
}

/** looks like the `enquirer` package */
export type EnquirerLike = {
  prompt: <T>(params: {
    type: 'input'
    name: string
    message: string
    validate?: (input: string) => boolean | string
    initial?: unknown
  }) => Promise<T>
}

export type Promptable =
  | InquirerPromptsLike
  | EnquirerLike
  | PromptsLike
  | Prompter
  | ((command: CommanderProgramLike) => Prompter)

export type TrpcCliRunParams = {
  argv?: string[]
  logger?: Logger
  completion?: OmeletteInstanceLike | (() => Promise<OmeletteInstanceLike>)
  prompts?: Promptable
  /** Format an error thrown by the root procedure before logging to `logger.error` */
  formatError?: (error: unknown) => string
  process?: {
    exit: (code: number) => never
  }
}

export type CommanderProgramLike = {
  name: () => string
  parseAsync: (args: string[], options?: {from: 'user' | 'node' | 'electron'}) => Promise<unknown>
  helpInformation: () => string
}

export interface TrpcCli {
  run: (params?: TrpcCliRunParams, program?: CommanderProgramLike) => Promise<void>
  buildProgram: (params?: TrpcCliRunParams) => CommanderProgramLike
}

// todo: allow these all to be async?
export type Dependencies = {
  /** A custom `zod` module to use for converting to JSON schema. Defaults to zod v3, which *doesn't* convert to JSON schema and generating readable error messages.
   * Required when using zod v4 with (experimental) JSON schema output built-in.
   *
   * For zod v3 (the default), the `zod-to-json-schema` package is used for JSON schema output and
   * `zod-validation-error` is used for readable error messages.
   */
  zod?: {
    prettifyError?: (error: never) => string
    toJSONSchema?: (schema: never, options: Record<string, unknown>) => {}
    string: () => {}
  }
  '@valibot/to-json-schema'?: {
    toJsonSchema: (input: unknown, options?: {errorMode?: 'throw' | 'ignore' | 'warn'}) => JSONSchema7
  }
  effect?: {
    Schema: {isSchema: (input: unknown) => input is 'JSONSchemaMakeable'}
    JSONSchema: {make: (input: 'JSONSchemaMakeable') => JSONSchema7}
  }
}

export type PromptContext = {
  // eslint-disable-next-line no-undef
  input?: NodeJS.ReadableStream
  // eslint-disable-next-line no-undef
  output?: NodeJS.WritableStream
  clearPromptOnDone?: boolean
  signal?: AbortSignal
  /** The command that is being prompted for. Cast this to a `commander.Command` to access the command's name, description, options etc. */
  command: {name: () => string}
  /** The original inputs the user provided - if they passed some but not all arguments/options, this will contain the values they did pass. */
  inputs: {
    argv: string[]
    arguments: Array<{name: string; specified: boolean; value: unknown}>
    options: Array<{name: string; specified: boolean; value: unknown}>
  }
  /** If set, this is the argument that is being prompted for. Cast to a `commander.Argument`. */
  argument?: {name: () => string}
  /** If set, this is the option that is being prompted for. Cast to a `commander.Option`. */
  option?: {name: () => string}
}

export interface Prompter {
  setup?: (context: PromptContext) => Promise<void>
  teardown?: (context: PromptContext) => Promise<void>
  input: (
    params: {
      message: string
      validate?: (input: string) => boolean | string
      required?: boolean
      default?: string
    },
    context: PromptContext,
  ) => Promise<string>
  select: (
    params: {
      message: string
      choices: string[] | {name: string; value: string; description?: string}[]
      required?: boolean
      default?: string
      validate?: (input: string) => boolean | string
    },
    context: PromptContext,
  ) => Promise<string>
  confirm: (
    params: {
      message: string
      default?: boolean
      validate?: (input: string) => boolean | string
    },
    context: PromptContext,
  ) => Promise<boolean>
  checkbox: (
    params: {
      message: string
      choices: {name: string; value: string; checked?: boolean}[]
      // validate?: (input: readonly {name?: string; value: string}[]) => boolean | string
      required?: boolean
      default?: string[]
    },
    context: PromptContext,
  ) => Promise<string[]>
}
