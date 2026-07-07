import type {JSONSchema7} from 'json-schema'
import type {Readable, Writable} from 'node:stream'
import type {CommandJSON} from './json.js'
import {AnyRouter, CreateCallerFactoryLike, inferRouterContext} from './parse-router.js'

export interface TrpcCliParams<R extends AnyRouter> extends Dependencies {
  /** A tRPC router. Procedures will become CLI commands. */
  router: R
  name?: string
  version?: string
  description?: string
  usage?: string | string[]
  /** Context to be supplied when invoking the router. */
  context?: inferRouterContext<R>
  /** @deprecated this is actually **removed** not deprecated; use `aliases` on each procedure `meta` instead */
  alias?: never // ((fullName: string, meta: {command: string; flags: Record<string, unknown>}) => string | undefined)
  /** @deprecated this is actually **removed** not deprecated; set `default: true` on the procedure `meta` instead */
  _default?: never // {procedure: Extract<keyof R['_def']['procedures'], string>}

  /** The `@trpc/server` module to use for calling procedures. Required when using trpc v10. */
  // createCallerFactory?: CreateCallerFactoryLike
  trpcServer?: TrpcServerModuleLike | Promise<TrpcServerModuleLike>

  /**
   * Controls whether commands accept a `--json <json>` option supplying the complete procedure input as JSON.
   *
   * - `'never'` (default): commands don't accept `--json` (unless their schema defines a `json` property, or their schema couldn't be converted to CLI arguments, in which case `--json` is the only way to pass input).
   * - `'auto'`: every command accepts `--json` as an alternative to its schema-derived flags and positional arguments. When `--json` is passed it must be the *only* input - combining it with other flags or positional arguments results in an unknown option error. Exception: if a procedure's schema already defines a `json` property, the schema wins - that command keeps its regular schema-derived `--json` flag.
   * - `'always'`: every command *only* accepts `--json` - no schema-derived flags or positional arguments.
   *
   * Commands whose procedures accept no input at all never get `--json`, in any mode - there's nothing to provide.
   *
   * Individual procedures can override this with `jsonInput` in their meta.
   */
  jsonInput?: JsonInputMode
}

/**
 * @experimental Derive a CLI from a plain TypeScript module of exported functions/classes instead of a router.
 * Exported functions become commands: the jsdoc above each function becomes the command description, and the first
 * parameter's object type annotation (parsed from the module's *source text* via the vendored `trpc-cli/typebox`
 * `Type.Script`) becomes the input schema - property jsdoc comments become flag descriptions, and inputs are
 * validated against the schema before the function runs. Exported functions whose signatures cannot be converted
 * into CLI inputs are ignored as ordinary non-command exports. `@alias` tags in command/property jsdoc become
 * command and option aliases. A default-exported function becomes the default command, equivalent to `{default:
 * true}` in procedure meta. Exported classes become nested command groups when they have no constructor arguments
 * and at least one public command method; default-exported classes put their methods at the current router level.
 * Classes with `extends` must declare an explicit zero-argument constructor. Unsupported class shapes are ignored
 * as ordinary non-command exports. Their public instance methods are lazily invoked on a fresh class instance. In
 * file-backed module mode, `export * as foo from './foo'` becomes a nested sub-router named `foo`, `export * from './foo'`
 * merges that module's named commands into the current router level, and `export {foo} from './foo'` re-exports
 * selected commands.
 *
 * `import.meta` satisfies this shape (it carries `filename`/`url`), so the simplest setup is to call `createCli`
 * from the bottom of the commands file itself:
 *
 * @example
 * ```ts
 * // commands.ts
 * import {createCli} from 'trpc-cli'
 *
 * /** install dependencies from the lockfile *\/
 * export async function install(options: {frozenLockfile?: boolean}) { ... }
 *
 * void createCli(import.meta).run() // <- at the BOTTOM of the file, and don't `await` it (see note below)
 * ```
 *
 * Or point at a separate file from an entrypoint:
 *
 * @example
 * ```ts
 * import {createCli} from 'trpc-cli'
 * void createCli({filename: '/path/to/commands.ts'}).run()
 * ```
 *
 * Note on `createCli(import.meta)`: because trpc-cli only receives the file's location (not its exports), it
 * re-imports the file to get the live functions. When the call lives in the commands file itself this is a
 * self-import, which is fine **as long as** the call is at the bottom of the file (so all `export const` arrow
 * functions above it are initialized) and is **not** top-level-`await`ed (a top-level `await` would suspend the
 * module before the self-import can resolve, deadlocking). `void createCli(import.meta).run()` is the safe form.
 * If another module imports this file, the `.run()` call is a no-op, so the exported command functions remain
 * importable as plain functions.
 */
export interface TrpcCliModuleParams {
  /**
   * @experimental
   * Where to find the commands module:
   * - pass `import.meta` directly (it has `filename`/`url`) for the zero-config single-file setup
   * - a `URL` like `new URL('./commands.ts', import.meta.url)` - resolved relative to the importing file, so the
   *   CLI works no matter what directory it's run from (use this for anything you distribute)
   * - an absolute path (e.g. `import.meta.filename`) or a path string - a relative string is resolved against
   *   `process.cwd()`, so it's only reliable when the CLI is run from a known directory (fine for quick scripts)
   *
   * The file is read from disk and dynamically imported - for `.ts` files, run under tsx/bun/deno/node>=22.18.
   * Re-exported command modules are resolved relative to this file.
   */
  filename?: string | URL
  /**
   * @experimental `import.meta.url`. Used as a fallback when `filename` isn't populated (e.g. older Node where
   * `import.meta.filename` doesn't exist, or non-node runtimes), so that passing `import.meta` always works.
   * Ignored when `filename` is set.
   */
  url?: string
  /**
   * @experimental Bundler/browser escape hatch (no filesystem, no dynamic import): the module's raw source text.
   * Re-exported command modules are not supported in this form.
   * Pass alongside {@linkcode TrpcCliModuleParams.exports}, e.g. `{source: rawSourceText, exports: await import('./commands.js')}`.
   */
  source?: string
  /** @experimental Bundler/browser escape hatch: the module's live exports. Pass alongside {@linkcode TrpcCliModuleParams.source}. */
  exports?: Record<string, unknown>
  name?: string
  version?: string
  description?: string
  usage?: string | string[]
  /** See {@linkcode TrpcCliParams.jsonInput} */
  jsonInput?: JsonInputMode
}

/**
 * Mode for the `jsonInput` setting (CLI-wide via `createCli({jsonInput: ...})` or per-procedure via meta):
 * - `'never'` (default): the command doesn't accept `--json` at all
 * - `'auto'`: the command accepts `--json <json>` as an alternative to its schema-derived flags/positional arguments
 * - `'always'`: the command *only* accepts `--json <json>`
 */
export type JsonInputMode = 'never' | 'auto' | 'always'

/** Rough shape of the `@trpc/server` (v10) module. Needed to pass in to `createCli` when using trpc v10. */
export type TrpcServerModuleLike = {
  initTRPC: {create: () => {createCallerFactory: CreateCallerFactoryLike<{}>}}
}

/**
 * Optional interface for describing procedures via meta - if your router conforms to this meta shape, it will contribute to the CLI help text.
 */

export interface TrpcCliMeta {
  /**
   * If true, will always prompt the user for input, if false, will never prompt, if not set, will prompt if input is missing.
   * Has no effect if `prompts` have not been passed to the `run` function.
   */
  prompt?: boolean
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
  /**
   * Per-procedure override of the CLI-wide `jsonInput` setting (see `TrpcCliParams`).
   * If `'always'`, this command uses a single `--json <json>` option expecting the entire input as JSON, e.g. `--json '{"foo": "bar"}'` - useful to opt out of the default mapping of input schemas to CLI options.
   * If `'auto'`, this command accepts `--json` as an alternative to its schema-derived flags/positional arguments.
   * If `'never'` (default), this command is always built from its schema and won't accept `--json`.
   */
  jsonInput?: JsonInputMode
  /** Sub-property for the CLI meta. If present, will take precedence over the top-level meta, to avoid conflicts with other tools. */
  cliMeta?: TrpcCliMeta
  /** If set to true, add a "--no-*" option to negate each boolean option by default. Can still be overriden by doing `z.boolean().meta({negatable: ...})` or equivalent. */
  negateBooleans?: boolean
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
  optionsJsonSchema: JSONSchema7
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

export type ClackPromptsLike = {
  intro: (title: string) => void
  outro: (title: string) => void
}

export type Promptable =
  | InquirerPromptsLike
  | EnquirerLike
  | PromptsLike
  | Prompter
  | ClackPromptsLike
  | ((command: CommanderProgramLike) => Prompter)

export type TrpcCliRunParams = {
  argv?: string[]
  logger?: Logger
  completion?: OmeletteInstanceLike | (() => Promise<OmeletteInstanceLike>)
  prompts?: Promptable | boolean | null
  /** Format an error thrown by the root procedure before logging to `logger.error` */
  formatError?: (error: unknown) => string
  process?: {
    exit: (code: number) => never
  }
}

/**
 * Type that looks like a `commander` Command instance, but doesn't require a dependency on `commander` to avoid awkward typescript errors.
 * If you need to use it as a `Command` instance, just cast it with `as` to `import('commander').Command`.
 */
export type CommanderProgramLike = {
  name: () => string
  parseAsync: (args: string[], options?: {from: 'user' | 'node' | 'electron'}) => Promise<unknown>
  helpInformation: () => string
  commands?: readonly CommanderProgramLike[]
  hidden?: boolean
  _hidden?: boolean
}

export interface TrpcCli {
  /** run the CLI - gets args from `process.argv` by default */
  run: (params?: TrpcCliRunParams, program?: CommanderProgramLike) => Promise<void>
  /**
   * Build a `Commander` program from the CLI - you can use this to manually customise the program before passing it to `.run(...)`.
   * Note that you will need to cast the return value to `import('commander').Command` to use it as a `Command` instance.
   */
  buildProgram: (params?: TrpcCliRunParams) => CommanderProgramLike
  /**
   * @experimental
   * Get a JSON representation of the CLI - useful for generating documentation etc. This function returns basic information about the CLI
   * and each command - to get any extra details you will need to use the `buildProgram` function and walk the tree of commands yourself.
   */
  toJSON: (program?: CommanderProgramLike) => CommandJSON
}

export type TrpcCliAsync = {
  /** run the CLI - gets args from `process.argv` by default */
  run: (params?: TrpcCliRunParams, program?: CommanderProgramLike) => Promise<void>
  /**
   * Build a `Commander` program from the CLI - you can use this to manually customise the program before passing it to `.run(...)`.
   * Note that you will need to cast the return value to `import('commander').Command` to use it as a `Command` instance.
   */
  buildProgram: (params?: TrpcCliRunParams) => Promise<CommanderProgramLike>
  /**
   * @experimental
   * Get a JSON representation of the CLI - useful for generating documentation etc. This function returns basic information about the CLI
   * and each command - to get any extra details you will need to use the `buildProgram` function and walk the tree of commands yourself.
   */
  toJSON: (program?: CommanderProgramLike) => Promise<CommandJSON>
}

// todo: allow these all to be async?
export type Dependencies = {
  '@valibot/to-json-schema'?: {
    toJsonSchema: (input: unknown, options?: {errorMode?: 'throw' | 'ignore' | 'warn'}) => JSONSchema7
  }
  effect?: {
    Schema: {isSchema: (input: unknown) => input is 'JSONSchemaMakeable'}
    JSONSchema: {make: (input: 'JSONSchemaMakeable') => JSONSchema7}
  }
}

export type PromptContext = {
  input?: Readable
  output?: Writable
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
