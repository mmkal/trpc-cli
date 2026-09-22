/**
 * @experimental Derive a CLI from a plain TypeScript module of exported functions/classes - no schema library, no router.
 *
 * Runtime functions carry no type information, so this works from two inputs: the module's *source text* (to extract
 * each exported function/class method's parameter types and jsdoc) and its *live exports* (to actually call the functions).
 * The extracted parameter type text is handed to the vendored `Type.Script` (see ./typebox), which turns it into a
 * JSON Schema - including jsdoc comments as property descriptions - with a `~standard` validator attached. Each
 * function becomes a norpc procedure, so the rest of trpc-cli treats the module like any other router: leading
 * scalar parameters become positional arguments and a trailing object-literal parameter becomes flags (the same
 * convention as trpc-cli's tuple inputs), while single-object-parameter functions are flags-only. Exported
 * functions whose signatures cannot be converted into CLI inputs are ignored as ordinary non-command exports.
 * Command-group-shaped exported classes become nested command groups whose public instance methods are invoked on a
 * fresh class instance only when the command runs; a default-exported class puts its methods at the current router
 * level. Classes with constructor arguments, no public command methods, or `extends` without an explicit
 * zero-argument constructor are ignored as ordinary non-command exports. File-backed modules can re-export other
 * command modules: `export * as group from './group'` creates a nested router, `export * from './group'` merges
 * named child commands into the current router, and `export {Foo} from './foo'` re-exports selected commands.
 *
 * Exports that carry their own schemas skip the type parsing entirely: `fn(...).implement(...)` results (see ./fn -
 * any Standard Schema, parameter names from the callback itself) and, through an adapter, zod's
 * `z.function(...).implement(...)` results (zod >=4.5 attaches the schemas as `_zod`; the callback stays private,
 * so its parameter names are read from the `.implement(` text). Both become a `CommandFunction` and share one
 * procedure builder; source is only consulted for the export declaration (position, jsdoc). All three kinds mix
 * freely in one module.
 *
 * The source "parser" here is deliberately a lightweight hand-rolled extractor, not the TypeScript compiler API:
 * it only needs to find exported function/class method declarations, the jsdoc immediately preceding them, and each
 * parameter's name + balanced `{...}` (or named-reference) type annotation text. The heavy lifting - turning type
 * syntax into JSON Schema - is all `Type.Script`.
 */
import {fnDefinition as fnDefinitionKey, FnImplemented, isFnImplemented} from './fn.js'
import {flattenedProperties, getEnumChoices, toJsonSchema} from './json-schema.js'
import {t} from './norpc.js'
import {isOptional} from './parse-procedure.js'
import {NorpcProcedureLike, NorpcRouterLike} from './parse-router.js'
import {StandardSchemaV1} from './standard-schema/contract.js'
import {toDotPath} from './standard-schema/errors.js'
import {validateTuple} from './standard-schema/tuple.js'
import Type from './typebox/index.js'
import {TrpcCliMeta} from './types.js'
import {getSchemaTypes, kebabCase} from './util.js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any

type SourceCliModule = {source: string; exports: Record<string, unknown>}
type FileSourceModule = {source: string; filepath: string}
type FileCliModule = SourceCliModule & {filepath: string}

interface ModuleFileLoader {
  load: (filepath: string | URL) => Promise<FileCliModule>
  loadSpecifier: (parentFilepath: string, specifier: string) => Promise<FileCliModule>
  loadSourceSpecifier: (parentFilepath: string, specifier: string) => Promise<FileSourceModule>
}

interface ModuleReexport {
  kind: 'all' | 'namespace' | 'named'
  specifier: string
  name: string | undefined
  names?: Array<{imported: string; exported: string}>
}

class SkippedModuleCommandError extends Error {}

const moduleFileExtensions = ['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs']

/**
 * @experimental
 * The resolved commands-module input handed to {@linkcode moduleToRouter}: a `URL` like
 * `new URL('./commands.ts', import.meta.url)` (resolved relative to the importing file - works no matter what
 * directory the CLI is run from), a path string (resolved against `process.cwd()` - fine for quick scripts, fragile
 * for distributed CLIs), or an explicit `{source, exports}` pair for environments where file reading/dynamic import
 * isn't possible (bundlers, browsers): `{source: rawSourceText, exports: await import('./commands.js')}`. The file
 * forms are read with `node:fs` and dynamically imported - run under tsx/bun/deno/node>=22.18 for `.ts` files.
 *
 * Note: `createCli` accepts the friendlier `{filename}`/`import.meta`/`{source, exports}` shape
 * ({@linkcode TrpcCliModuleParams}) and normalizes it to this type.
 */
export type CliModuleInput = string | URL | {source: string; exports: Record<string, unknown>}

/** A command extracted from module source text. */
export interface ExtractedCommand {
  /** the export name, e.g. `installPackages` - becomes the (kebab-cased) command name */
  name: string
  /** the runtime module export to call; differs from `name` for `export default function named(...)` */
  exportName: string
  /** true for a default export, which becomes the CLI's default command */
  default: boolean
  /** source offset of the declaration - commands are ordered by it in `--help` */
  position: number
  /** cleaned jsdoc text from the comment immediately preceding the export - becomes the command description */
  description: string | undefined
  /** the function's parameters, in declaration order. Empty = command with no args. For overloaded functions, the first signature's parameters */
  params: ExtractedParam[]
  /**
   * present when the function is declared with multiple TS overload signatures: one entry per body-less signature,
   * in declaration order (the first entry mirrors `description`/`params`). The implementation signature is never
   * included. See `buildOverloadedProcedure` for how overloads become alternate calling conventions.
   */
  overloads?: ExtractedOverload[]
  /**
   * cleaned jsdoc of the overload *implementation* signature, when the export is overloaded. Each overload
   * signature's jsdoc describes just that calling convention, so this is the natural home for a description of
   * the command as a whole.
   */
  implementationDescription?: string
}

/** One signature of a command declared with multiple TS overload signatures. */
export interface ExtractedOverload {
  /** cleaned jsdoc text from the comment immediately preceding this signature */
  description: string | undefined
  params: ExtractedParam[]
}

export interface ExtractedClass {
  /** the export name, e.g. `Users` - becomes the (kebab-cased) command group name */
  name: string
  /** the runtime module export to instantiate; differs from `name` for `export default class ...` */
  exportName: string
  /** true for `export default class`, whose methods become root commands */
  default: boolean
  methods: ExtractedCommand[]
}

/** A parameter extracted from a function declaration's parameter list. */
export interface ExtractedParam {
  /** the parameter name, e.g. `left` - becomes the (kebab-cased) positional argument name. Undefined for destructured patterns like `{force}` */
  name: string | undefined
  /** true if marked with `?` or given a default value - trailing optional scalars become optional positionals */
  optional: boolean
  /** raw text of the type annotation, e.g. `number` or `{force?: boolean}` */
  typeText: string
  /** cleaned jsdoc from an inline block comment before the parameter, e.g. `(/** the left operand *\/ left: number)` - becomes the positional description (falling back to a `@param` tag in the function's jsdoc) */
  description: string | undefined
  /** true if the parameter is a destructuring pattern like `{force}` or `[a, b]` */
  destructured: boolean
}

/**
 * @experimental Resolve a `CliModuleInput` to a norpc router. The string/URL forms read the file and dynamically
 * import it - `node:` modules are imported lazily here so this file stays safe to bundle for non-node targets.
 */
export const moduleToRouter = async (moduleInput: CliModuleInput): Promise<NorpcRouterLike> => {
  if (typeof moduleInput === 'string' || moduleInput instanceof URL) {
    const loader = await createModuleFileLoader()
    return buildRouterFromFileModule(await loader.load(moduleInput), loader, [])
  }
  return buildRouterFromModule(moduleInput)
}

const createModuleFileLoader = async (): Promise<ModuleFileLoader> => {
  const [fs, path, url] = await Promise.all([
    import('node:fs/promises'),
    // eslint-disable-next-line unicorn/import-style -- dynamic import: there's no "default import" syntax to use here
    import('node:path').then(m => m.default),
    import('node:url'),
  ])

  const sourceCache = new Map<string, Promise<FileSourceModule>>()
  const moduleCache = new Map<string, Promise<FileCliModule>>()

  const loadSourceResolvedPath = (fullpath: string) => {
    const normalized = path.resolve(fullpath)
    const cached = sourceCache.get(normalized)
    if (cached) return cached
    const promise = (async (): Promise<FileSourceModule> => {
      const source = await fs.readFile(normalized, 'utf8').catch((e: unknown) => {
        throw new Error(`Could not read module source at ${normalized}`, {cause: e})
      })
      return {source, filepath: normalized}
    })()
    sourceCache.set(normalized, promise)
    return promise
  }

  const loadResolvedPath = (fullpath: string) => {
    const normalized = path.resolve(fullpath)
    const cached = moduleCache.get(normalized)
    if (cached) return cached
    const promise = (async (): Promise<FileCliModule> => {
      const {source} = await loadSourceResolvedPath(normalized)
      const exports = (await import(url.pathToFileURL(normalized).href).catch((e: unknown) => {
        throw new Error(
          `Could not import module at ${normalized}. For TypeScript modules, run under tsx, bun, deno, or node >=22.18 (which strip types natively).`,
          {cause: e},
        )
      })) as Record<string, unknown>
      return {source, exports: {...exports}, filepath: normalized}
    })()
    moduleCache.set(normalized, promise)
    return promise
  }

  const fileExists = async (fullpath: string) =>
    fs
      .stat(fullpath)
      .then(stat => stat.isFile())
      .catch(() => false)

  const resolveSpecifier = async (parentFilepath: string, specifier: string) => {
    if (!specifier.startsWith('./') && !specifier.startsWith('../')) {
      throw new Error(
        `Could not resolve re-export ${JSON.stringify(specifier)} from ${parentFilepath}. Only relative module specifiers are supported.`,
      )
    }

    const exact = path.resolve(path.dirname(parentFilepath), specifier)
    const extension = path.extname(exact)
    const extensionAlternates: Record<string, string[]> = {
      '.cjs': ['.cts', '.ts'],
      '.js': ['.ts', '.tsx'],
      '.mjs': ['.mts', '.ts'],
    }
    const candidates = extension
      ? [exact, ...(extensionAlternates[extension] || []).map(ext => `${exact.slice(0, -extension.length)}${ext}`)]
      : [exact, ...moduleFileExtensions.map(ext => `${exact}${ext}`)]
    for (const candidate of candidates) {
      if (await fileExists(candidate)) return candidate
    }
    throw new Error(
      `Could not resolve re-export ${JSON.stringify(specifier)} from ${parentFilepath}. Tried ${candidates.join(', ')}.`,
    )
  }

  return {
    load: filepath => {
      // a URL (`new URL('./commands.ts', import.meta.url)`) pins the module to the importing file; a plain string is cwd-relative
      const fullpath =
        typeof filepath === 'string' ? path.resolve(process.cwd(), filepath) : url.fileURLToPath(filepath)
      return loadResolvedPath(fullpath)
    },
    loadSpecifier: async (parentFilepath, specifier) =>
      loadResolvedPath(await resolveSpecifier(parentFilepath, specifier)),
    loadSourceSpecifier: async (parentFilepath, specifier) =>
      loadSourceResolvedPath(await resolveSpecifier(parentFilepath, specifier)),
  }
}

/**
 * @experimental Build a norpc router from a module's source text + live exports. Exported functions become
 * procedures when their signatures can be converted into CLI inputs: source order determines command order,
 * function jsdoc becomes the command description, and parameter type annotations (inline literals, or references to
 * a `type`/`interface` declared in the same file) are parsed by the vendored `Type.Script` into the input schema.
 * Leading scalar parameters become positional arguments; a trailing object parameter becomes flags.
 */
export const buildRouterFromModule = (resolved: {
  source: string
  exports: Record<string, unknown>
}): NorpcRouterLike => {
  const reexports = extractModuleReexports(resolved.source)
  if (reexports.length > 0) {
    throw new Error(
      `Re-exported command modules are only supported with file-backed module mode. Pass a filename, URL, or import.meta to createCli; the {source, exports} escape hatch cannot resolve ${reexports.map(reexport => JSON.stringify(reexport.specifier)).join(', ')}.`,
    )
  }

  const procedures = buildLocalProcedures(resolved, buildDeclarationContext(resolved.source))
  assertHasProcedures(procedures)
  return t.router(procedures)
}

const buildRouterFromFileModule = async (
  resolved: FileCliModule,
  loader: ModuleFileLoader,
  ancestors: string[],
): Promise<NorpcRouterLike> => {
  if (ancestors.includes(resolved.filepath)) {
    throw new Error(`Circular module re-export detected: ${[...ancestors, resolved.filepath].join(' -> ')}`)
  }

  const context = await buildFileDeclarationContext(resolved, loader)
  const procedures = buildLocalProcedures(resolved, context)
  const childAncestors = [...ancestors, resolved.filepath]
  for (const reexport of extractModuleReexports(resolved.source)) {
    const child = await loader.loadSpecifier(resolved.filepath, reexport.specifier)
    const childRouter = await buildRouterFromFileModule(child, loader, childAncestors)

    if (reexport.kind === 'namespace') {
      addProcedureOrRouter(procedures, reexport.name!, childRouter, resolved.filepath, child.filepath)
      continue
    }

    if (reexport.kind === 'named') {
      for (const {imported, exported} of reexport.names || []) {
        const procedureOrRouter = childRouter[imported]
        if (!procedureOrRouter) continue
        addProcedureOrRouter(procedures, exported, procedureOrRouter, resolved.filepath, child.filepath)
      }
      continue
    }

    for (const [name, procedureOrRouter] of Object.entries(childRouter)) {
      // `export * from` follows ESM semantics: default exports and ambiguous/conflicting star exports are not present
      // on the parent module namespace, so only merge names that the runtime import actually exposed.
      if (!(name in resolved.exports)) continue
      addProcedureOrRouter(procedures, name, procedureOrRouter, resolved.filepath, child.filepath)
    }
  }

  assertHasProcedures(procedures)
  return t.router(procedures)
}

// ------------------------------------------------------------------
// schema-carrying function exports: `fn(...).implement(...)` and, via an adapter, `z.function(...).implement(...)`
// ------------------------------------------------------------------

/**
 * What a schema-carrying export boils down to before it becomes a procedure. `fn()` exports carry this directly
 * (see ./fn); zod functions are adapted into it by `zodFunctionCommand`, which is the only place that still reads
 * the source for anything beyond the export declaration.
 */
interface CommandFunction {
  /** tuple item schemas: leading scalars become positionals, a trailing object becomes flags. Empty = no arguments */
  input: StandardSchemaV1[]
  meta: TrpcCliMeta
  /** parameter names of the implementation, for positional argument names in help; undefined entries for destructured/rest params */
  paramNames: Array<string | undefined> | undefined
  call: (...args: unknown[]) => unknown
}

const fnCommand = (implemented: FnImplemented<unknown[], unknown>): CommandFunction => {
  const definition = implemented[fnDefinitionKey]
  return {
    input: definition.input,
    meta: definition.meta,
    paramNames: parseFunctionParamNames(scanSource(definition.implementation.toString()), 0),
    call: implemented,
  }
}

/**
 * The runtime shape of a `z.function(...).implement(fn)` result: zod >=4.5 attaches the function schema's
 * internals as a non-enumerable `_zod` property (https://github.com/colinhacks/zod/issues/6104). Duck-typed
 * rather than imported from zod, which is an optional peer dependency.
 */
interface ZodImplementedFunction {
  (...args: unknown[]): unknown
  _zod: {
    def: {
      type: 'function'
      /** a `ZodTuple` when `input: [...]` was given; zod defaults to `z.array(z.unknown())` when it wasn't */
      input: {_zod: {def: {type: string; items?: unknown[]; rest?: unknown; element?: {_zod: {def: {type: string}}}}}}
    }
  }
}

const isZodImplementedFunction = (value: unknown): value is ZodImplementedFunction =>
  typeof value === 'function' &&
  '_zod' in value &&
  (value as {_zod?: {def?: {type?: unknown}}})._zod?.def?.type === 'function'

/**
 * Adapt a zod function into a `CommandFunction`. zod keeps the `.implement()` callback private, so the parameter
 * names are read from the `.implement((name, options) => ...)` text in the source instead.
 */
const zodFunctionCommand = (
  name: string,
  zodFn: ZodImplementedFunction,
  scan: SourceScan,
  declarationPosition: number,
): CommandFunction => {
  const inputDef = zodFn._zod.def.input._zod.def
  const noInput = inputDef.type === 'array' && inputDef.element?._zod.def.type === 'unknown' // `z.function()` with no `input`
  if (!noInput && (inputDef.type !== 'tuple' || inputDef.rest)) {
    throw new Error(
      `Zod function ${JSON.stringify(name)} has ${inputDef.type === 'tuple' ? 'rest arguments in its' : `an ${inputDef.type}`} input, which isn't supported. Use a tuple input like \`z.function({input: [z.string(), z.object({...})]})\` so parameters can map to positional arguments and flags.`,
    )
  }
  return {
    input: noInput ? [] : ((inputDef.items || []) as StandardSchemaV1[]),
    meta: {},
    paramNames: extractImplementParamNames(scan, declarationPosition),
    call: zodFn,
  }
}

/**
 * Find the `export const <name> = ...` (or `export default ...`) declaration of a schema-carrying function export,
 * for its jsdoc (description, `@alias`) and its source position (command order - ESM namespace keys are
 * alphabetical). Undefined when this file doesn't declare it - e.g. it arrived via `export * from './child'`, in
 * which case the child's router owns it.
 */
const findExportDeclaration = (scan: SourceScan, name: string) => {
  const {source} = scan
  // static pattern + compare the captured identifier, rather than interpolating `name` (which may contain `$`)
  const pattern = /(?<![.\w$])export\s+(?:(default)(?![\w$])|(?:const|let|var)\s+([A-Za-z_$][\w$]*))/g
  const match = [...source.matchAll(pattern)].find(m => (m[1] || m[2]) === name && !scan.masked[m.index])
  return match && {position: match.index, description: jsdocBefore(scan, match.index)}
}

/**
 * Parameter names of the `.implement(...)` callback in the declaration starting at `start`. Best effort: undefined
 * when the declaration has no inline `.implement(` before the next export (e.g. `export const a = makeCommand()`).
 */
const extractImplementParamNames = (scan: SourceScan, start: number): Array<string | undefined> | undefined => {
  const {source} = scan
  const firstUnmaskedAfterStart = (pattern: RegExp) =>
    [...source.matchAll(pattern)].find(m => m.index > start && !scan.masked[m.index])
  const implement = firstUnmaskedAfterStart(/\.implement(?:Async)?\s*\(/g)
  const nextExport = firstUnmaskedAfterStart(/(?<![.\w$])export\s/g)
  if (!implement || (nextExport && nextExport.index < implement.index)) return undefined
  return parseFunctionParamNames(scan, implement.index + implement[0].length)
}

/**
 * Parameter names of the function expression starting at `start` in `scan.source`: `(a, b) => ...`,
 * `async (a) => ...`, `function name(a) {...}`, a method's `name(a) {...}` (what `Function.prototype.toString`
 * gives), or a bare `a => ...`. An undefined entry means a destructured or rest parameter.
 */
const parseFunctionParamNames = (scan: SourceScan, start: number): Array<string | undefined> | undefined => {
  const {source} = scan
  const rest = source.slice(start)
  const bare = /^\s*(?:async\s+)?([A-Za-z_$][\w$]*)\s*=>/.exec(rest)
  if (bare) return [bare[1]]
  const head = /^\s*(?:async\s+)?(?:function\b\s*\*?\s*)?(?:[A-Za-z_$][\w$]*\s*)?/.exec(rest)![0]
  const parenIndex = start + head.length
  if (source[parenIndex] !== '(') return undefined
  const paramList = source.slice(parenIndex + 1, findBalancedEnd(scan, parenIndex, '(', ')') - 1)
  return splitTopLevelCommas(scanSource(paramList)).map(({start: from, end}) => {
    const text = paramList
      .slice(from, end)
      .replaceAll(/\/\*[\S\s]*?\*\//g, '')
      .trim()
    return /^([A-Za-z_$][\w$]*)/.exec(text)?.[1]
  })
}

/**
 * Build a procedure from a `CommandFunction`. The item schemas are converted to JSON schema individually and
 * assembled into a tuple schema (so the usual tuple convention applies: leading scalars become positionals, a
 * trailing object becomes flags, and an optional trailing object makes the flags optional), with `title`s from the
 * implementation's parameter names on scalar items that don't already have one. The tuple validates via the
 * original schemas. Explicit `.describe()`/`.meta()` win over the declaration's jsdoc.
 */
const buildCommandFunctionProcedure = (
  name: string,
  command: CommandFunction,
  jsdoc: string | undefined,
): NorpcProcedureLike => {
  const commandDoc = parseCliJsdoc(jsdoc)
  const meta: TrpcCliMeta = {
    ...(commandDoc.description ? {description: commandDoc.description} : {}),
    ...(commandDoc.aliases.length > 0 ? {aliases: {command: commandDoc.aliases}} : {}),
    ...(name === 'default' ? {default: true} : {}), // `export default fn(...)` - the CLI's default command, like a default-exported plain function
    ...command.meta,
  }
  const builder = Object.keys(meta).length > 0 ? t.procedure.meta(meta) : t.procedure
  if (command.input.length === 0) return builder.handler(() => command.call())

  const items = command.input.map((schema, i) => {
    const converted = toJsonSchema(schema, {})
    if (!converted.success) throw new Error(`Input ${i + 1} of ${JSON.stringify(name)}: ${converted.error}`)
    // shallow copy: zod stamps its output with a non-enumerable `~standard` claiming vendor `zod`, which would
    // route the plain JSON schema back into the zod converter
    const item = {...converted.value}
    const paramName = command.paramNames?.[i]
    if (!paramName) return item
    if (isObjectLikeSchema(item)) {
      applyParamTagPropertyDescriptions(item, paramName, commandDoc.params) // `@param options.force ...` documents a flag
      return item
    }
    if (!item.title) item.title = kebabCase(paramName)
    if (!item.description && commandDoc.params[paramName]) item.description = commandDoc.params[paramName] // `.describe()` wins over `@param`
    return item
  })
  const firstOptional = items.findIndex(item => isOptional(item))
  const schema = {
    type: 'array',
    items,
    minItems: firstOptional === -1 ? items.length : firstOptional,
    maxItems: items.length,
  }
  Object.defineProperty(schema, '~standard', {
    enumerable: false,
    value: {
      version: 1,
      vendor: 'trpc-cli',
      validate: (value: unknown) => validateTuple(command.input, value),
      jsonSchema: {input: () => schema, output: () => schema},
    },
  })
  return builder.input(schema as never).handler(({input}) => command.call(...(input as unknown[])))
}

const buildLocalProcedures = (resolved: SourceCliModule, context: Record<string, unknown>) => {
  const {source, exports} = resolved
  const scan = scanSource(source)

  // exported functions become commands in source order, whether their schemas come from parsed types or from zod
  const entries: Array<{name: string; position: number; procedure: NorpcProcedureLike}> = []
  for (const command of extractModuleCommands(scan)) {
    const fn = exports[command.exportName]
    if (typeof fn !== 'function') continue // e.g. `export const x = (2 + 3)` - extractor can match non-functions; runtime is the source of truth
    const procedure = tryBuildProcedure(command, fn as AnyFn, context)
    if (procedure) entries.push({name: command.name, position: command.position, procedure})
  }
  for (const [name, value] of Object.entries(exports)) {
    if (!isFnImplemented(value) && !isZodImplementedFunction(value)) continue
    const declaration = findExportDeclaration(scan, name)
    if (!declaration) continue // not declared in this file (e.g. `export * from './child'`) - the child's router owns it
    const command = isFnImplemented(value)
      ? fnCommand(value)
      : zodFunctionCommand(name, value, scan, declaration.position)
    const procedure = buildCommandFunctionProcedure(name, command, declaration.description)
    entries.push({name, position: declaration.position, procedure})
  }

  const procedures: Record<string, NorpcProcedureLike | NorpcRouterLike> = {}
  for (const entry of entries.sort((a, b) => a.position - b.position)) {
    addLocalProcedureOrRouter(procedures, entry.name, entry.procedure)
  }
  for (const extractedClass of extractModuleClasses(scan)) {
    const ClassCtor = exports[extractedClass.exportName]
    if (typeof ClassCtor !== 'function') continue
    if (ClassCtor.length > 0) continue
    const childProcedures: Record<string, NorpcProcedureLike> = {}
    for (const method of extractedClass.methods) {
      const procedure = tryBuildProcedure(
        method,
        (...args: unknown[]) => {
          const instance = new (ClassCtor as new () => Record<string, AnyFn>)()
          return (instance[method.name] as (...args: unknown[]) => unknown)(...args)
        },
        context,
      )
      if (!procedure) continue
      if (extractedClass.default) addLocalProcedureOrRouter(procedures, method.name, procedure)
      else childProcedures[method.name] = procedure
    }
    if (!extractedClass.default && Object.keys(childProcedures).length > 0) {
      addLocalProcedureOrRouter(procedures, extractedClass.name, t.router(childProcedures))
    }
  }

  return procedures
}

const addLocalProcedureOrRouter = (
  procedures: Record<string, NorpcProcedureLike | NorpcRouterLike>,
  name: string,
  procedureOrRouter: NorpcProcedureLike | NorpcRouterLike,
) => {
  if (name in procedures) throw new Error(`Module command ${JSON.stringify(name)} is declared more than once.`)
  procedures[name] = procedureOrRouter
}

const tryBuildProcedure = (
  command: ExtractedCommand,
  fn: AnyFn,
  context: Record<string, unknown>,
): NorpcProcedureLike | undefined => {
  try {
    return buildProcedure(command, fn, context)
  } catch (error) {
    if (error instanceof SkippedModuleCommandError) return undefined
    throw error
  }
}

const assertHasProcedures = (procedures: Record<string, NorpcProcedureLike | NorpcRouterLike>) => {
  if (Object.keys(procedures).length === 0) {
    throw new Error(
      `No commands found in module. Export functions with \`export function name(...)\`, \`export async function name(...)\`, \`export const name = (...) => ...\`, \`export const name = z.function(...).implement(...)\` or \`export default function name(...)\`, or export a command-group-shaped class.`,
    )
  }
}

const addProcedureOrRouter = (
  procedures: Record<string, NorpcProcedureLike | NorpcRouterLike>,
  name: string,
  procedureOrRouter: NorpcProcedureLike | NorpcRouterLike,
  parentFilepath: string,
  childFilepath: string,
) => {
  if (name in procedures) {
    throw new Error(
      `Re-exported command ${JSON.stringify(name)} from ${childFilepath} conflicts with an existing command or sub-router in ${parentFilepath}.`,
    )
  }
  procedures[name] = procedureOrRouter
}

const buildProcedure = (command: ExtractedCommand, fn: AnyFn, context: Record<string, unknown>): NorpcProcedureLike => {
  const commandDoc = parseCliJsdoc(command.description)
  const meta = {
    ...(commandDoc.description ? {description: commandDoc.description} : {}),
    ...(command.default ? {default: true} : {}),
    ...(commandDoc.aliases.length > 0 ? {aliases: {command: commandDoc.aliases}} : {}),
  }
  if (command.overloads) {
    const overloaded = buildOverloadedProcedure(command, fn, context, meta)
    if (overloaded) return overloaded
  }

  const builder = Object.keys(meta).length > 0 ? t.procedure.meta(meta) : t.procedure
  if (command.params.length === 0) {
    return builder.handler(() => fn())
  }

  const paramSchemas = command.params.map(param => parseParamSchema(command.name, param, context))

  if (command.params.length === 1 && isObjectLikeSchema(paramSchemas[0])) {
    // single object(-union) parameter: everything is a flag, the function receives the validated object directly
    applyParamTagPropertyDescriptions(paramSchemas[0], command.params[0].name, commandDoc.params)
    return builder.input(paramSchemas[0] as never).handler(({input}) => fn(input))
  }

  return buildPositionalProcedure(builder, command, fn, context, paramSchemas)
}

interface OverloadVariant {
  schema: unknown
  /** flags summary shown as this variant's usage line, e.g. `--name <string> [--dev]` */
  flags: string
  /** first line of this signature's jsdoc, shown as a comment on its usage line */
  description: string | undefined
}

/**
 * TS function overloads where every signature takes a single object(-like) parameter become a command with
 * alternate calling conventions: help shows one usage line per signature, the flags list is the union of all
 * signatures' flags (the existing union-of-objects derivation in parse-procedure.ts, including commander
 * `conflicts` for flags that never appear in the same signature), and validation checks each signature's schema
 * in declaration order - mirroring TS overload resolution - passing the first match to the function. The runtime
 * implementation dispatches on the input's shape itself, as overload implementations always do, so it doesn't
 * need to be told which signature matched. When nothing matches, the error reports each signature's issues,
 * closest match (fewest issues) first.
 *
 * Returns undefined for any other overload shape (positional parameters, differing arity, unparseable types),
 * falling back to the first signature only - the behavior before overload support existed. Positional parameters
 * are excluded because commander has no way to present alternate positional layouts for one command.
 */
const buildOverloadedProcedure = (
  command: ExtractedCommand,
  fn: AnyFn,
  context: Record<string, unknown>,
  meta: Record<string, unknown>,
): NorpcProcedureLike | undefined => {
  const variants: OverloadVariant[] = []
  for (const overload of command.overloads!) {
    if (overload.params.length !== 1) return undefined
    let schema: unknown
    try {
      schema = parseParamSchema(command.name, overload.params[0], context)
    } catch (error) {
      if (error instanceof SkippedModuleCommandError) return undefined
      throw error
    }
    if (!isObjectLikeSchema(schema)) return undefined
    const overloadDoc = parseCliJsdoc(overload.description)
    applyParamTagPropertyDescriptions(schema, overload.params[0].name, overloadDoc.params)
    variants.push({
      schema,
      flags: overloadFlagsSummary(schema),
      description: overloadDoc.description?.split('\n')[0],
    })
  }

  fillSharedFlagMetadata(variants)

  const combined = {anyOf: variants.map(variant => variant.schema)}
  Object.defineProperty(combined, '~standard', {
    configurable: true,
    enumerable: false,
    value: {
      version: 1,
      vendor: 'trpc-cli',
      validate: (input: unknown) => validateOverloads(variants, input),
      jsonSchema: {input: () => combined, output: () => combined},
    },
  })

  const flagsWidth = Math.max(...variants.map(variant => variant.flags.length))
  const usage = variants.map(variant =>
    variant.description ? `${variant.flags.padEnd(flagsWidth)}  # ${variant.description}` : variant.flags,
  )

  // Command-level description: each signature's jsdoc describes *its* calling convention (shown as that usage
  // line's comment), so presenting the first signature's jsdoc as the whole command's description would be
  // misleadingly universal. The implementation signature's jsdoc is the natural home for an overall description;
  // failing that, the signatures' (distinct) descriptions are joined. Command `@alias`es are honored wherever
  // they're declared.
  const implementationDoc = parseCliJsdoc(command.implementationDescription)
  const variantDocs = command.overloads!.map(overload => parseCliJsdoc(overload.description))
  const distinctDescriptions = [...new Set(variantDocs.map(doc => doc.description).filter(Boolean))]
  const description = implementationDoc.description || distinctDescriptions.join(' / ')
  const aliases = [...new Set([...implementationDoc.aliases, ...variantDocs.flatMap(doc => doc.aliases)])]
  const overloadedMeta: Record<string, unknown> = {...meta, usage}
  if (description) overloadedMeta.description = description
  else delete overloadedMeta.description
  if (aliases.length > 0) overloadedMeta.aliases = {command: aliases}
  else delete overloadedMeta.aliases

  return t.procedure
    .meta(overloadedMeta)
    .input(combined as never)
    .handler(({input}) => fn(input))
}

/** Validate against each overload's schema in declaration order, first match wins - the CLI equivalent of TS overload resolution. */
const validateOverloads = (variants: OverloadVariant[], input: unknown): StandardSchemaV1.Result<unknown> => {
  const failures: Array<{variant: OverloadVariant; issues: readonly StandardSchemaV1.Issue[]}> = []
  for (const variant of variants) {
    const result = (variant.schema as StandardSchemaV1)['~standard'].validate(input)
    if (result instanceof Promise) throw new TypeError('Overload schemas must validate synchronously') // Type.Script validators always do
    if (!result.issues) return result
    failures.push({variant, issues: result.issues})
  }
  // the signature producing the fewest issues is the one the user was closest to matching - report it first
  // (ties keep declaration order, since `sort` is stable)
  const sorted = [...failures].sort((a, b) => a.issues.length - b.issues.length)
  const lines = sorted.map(failure => {
    const details = failure.issues.map(issue => {
      const path = (issue.path || []).map(segment => (typeof segment === 'object' ? segment.key : segment))
      return issue.message + (path.length > 0 ? ` (${toDotPath(path)})` : '')
    })
    return `  ${failure.variant.flags}: ${details.join('; ')}`
  })
  const message = `matched none of the ${variants.length} ways to call this command:\n${lines.join('\n')}`
  return {issues: [{message}]}
}

/**
 * A one-line usage summary of an overload signature's flags, e.g. `--name <string> --global [--save-dir <string>]`.
 * Booleans (including `true` literals like `global: true`) show as bare flags, string-literal unions show their
 * choices, everything else shows its type; flags that aren't required in every branch of the (possibly union)
 * schema are bracketed.
 */
const overloadFlagsSummary = (schema: unknown): string => {
  const properties = flattenedProperties(schema as never)
  const required = requiredInAllBranches(schema)
  const parts = Object.entries(properties).map(([key, propertySchema]) => {
    const flag = `--${kebabCase(key)}`
    const types = getSchemaTypes(propertySchema).filter(type => type !== 'undefined' && type !== 'null')
    const enumChoices = getEnumChoices(propertySchema)
    let placeholder: string | null
    if (types.length === 1 && types[0] === 'boolean') placeholder = null
    else if (enumChoices?.type === 'string_enum') placeholder = enumChoices.choices.join('|')
    else if (types.length === 1 && types[0] === 'array') placeholder = 'values...'
    else placeholder = types.join('|') || 'value'
    const part = placeholder ? `${flag} <${placeholder}>` : flag
    return required.has(key) && !isOptional(propertySchema) ? part : `[${part}]`
  })
  return parts.join(' ')
}

/**
 * Reconcile per-flag jsdoc across overload signatures. The union flag-merge in `flattenedProperties` keeps the
 * *last* occurrence of each property, which would silently drop a description or `@alias` declared on an earlier
 * signature. Descriptions: a flag documented in one signature (or identically in several) keeps that text; a flag
 * documented *differently* per signature (e.g. an `input` accepting subtly different values) shows every distinct
 * description, joined with ' / ' in declaration order. Aliases: first occurrence wins. Cosmetic metadata only -
 * validation behavior is unaffected.
 */
const fillSharedFlagMetadata = (variants: OverloadVariant[]) => {
  const branches = variants.flatMap(variant => objectBranches(variant.schema))
  const descriptions = new Map<string, string[]>()
  const aliases = new Map<string, unknown>()
  for (const branch of branches) {
    for (const [name, property] of Object.entries(branch.properties || {})) {
      if (typeof property.description === 'string') {
        const distinct = descriptions.get(name) || []
        if (!distinct.includes(property.description)) distinct.push(property.description)
        descriptions.set(name, distinct)
      }
      if (property.alias !== undefined && !aliases.has(name)) aliases.set(name, property.alias)
    }
  }
  for (const branch of branches) {
    for (const [name, property] of Object.entries(branch.properties || {})) {
      const description = descriptions.get(name)?.join(' / ')
      if (description) property.description = description
      if (aliases.has(name)) property.alias = aliases.get(name)
    }
  }
}

const objectBranches = (schema: unknown): Array<{properties?: Record<string, Record<string, unknown>>}> => {
  const {anyOf} = (schema || {}) as {anyOf?: unknown[]}
  if (Array.isArray(anyOf)) return anyOf.flatMap(objectBranches)
  return [schema as never]
}

/** Property names required in every branch of a (possibly `anyOf`-union) object schema. */
const requiredInAllBranches = (schema: unknown): Set<string> => {
  const {required, anyOf} = (schema || {}) as {required?: string[]; anyOf?: unknown[]}
  if (Array.isArray(anyOf)) {
    const sets = anyOf.map(requiredInAllBranches)
    return new Set([...(sets[0] || [])].filter(key => sets.every(set => set.has(key))))
  }
  return new Set(required || [])
}

/**
 * Multi-parameter functions (and single-scalar-parameter ones) map to trpc-cli's tuple-input convention:
 * `(a: number, b?: string, opts: {...})` behaves like a procedure with `.input(Type.Script('[number, (string) | undefined, {...}]'))` -
 * leading scalars become positional arguments, a trailing object becomes flags. We synthesize exactly that tuple
 * script and let the existing tuple handling in parse-procedure.ts do the work; the handler spreads the validated
 * tuple back into the function call. Optionality note: the vendored `Type.Script` silently drops tuple-element `?`
 * markers, so optional scalars are synthesized as `(T) | undefined` unions instead, which both validate `undefined`
 * (what an omitted positional arrives as) and register as optional with parse-procedure's existing typebox handling.
 */
const buildPositionalProcedure = (
  builder: typeof t.procedure,
  command: ExtractedCommand,
  fn: AnyFn,
  context: Record<string, unknown>,
  paramSchemas: unknown[],
): NorpcProcedureLike => {
  const {params} = command
  const paramTags = parseCliJsdoc(command.description).params
  const lastIsFlagsObject = isObjectLikeSchema(paramSchemas.at(-1))
  const positionalParams = lastIsFlagsObject ? params.slice(0, -1) : params

  positionalParams.forEach((param, i) => {
    const where = `Parameter ${i + 1} (${describeParam(param)}) of "${command.name}"`
    if (param.destructured) {
      throw new SkippedModuleCommandError(
        `${where} is a destructuring pattern, which isn't supported for positional arguments. Give the parameter a name, or move it into a trailing options object.`,
      )
    }
    if (isObjectLikeSchema(paramSchemas[i])) {
      throw new SkippedModuleCommandError(
        `${where} is an object type, but only the *last* parameter can be an object - leading parameters become positional arguments and a trailing object parameter maps to flags. Move it to the end, or flatten it into the trailing options object.`,
      )
    }
    if (isArrayOfPrimitives(paramSchemas[i])) {
      if (param.optional) {
        throw new SkippedModuleCommandError(
          `${where} is an optional array. Optional array parameters aren't supported as positional arguments - make it required, or move it into a trailing options object.`,
        )
      }
      return // required array of primitives -> variadic positional, supported by the existing tuple handling
    }
    if (!isPrimitiveish(paramSchemas[i])) {
      throw new SkippedModuleCommandError(
        `${where} has type \`${param.typeText}\`, which can't be used as a positional argument. Positional parameters must be strings, numbers, booleans (or arrays of those) - put other values in a trailing options object.`,
      )
    }
  })
  // only the *trailing* run of optional params can be optional positionals - you can't skip a positional argument
  // and provide a later one, so an optional param followed by a required one (legal TS via defaults, e.g.
  // `(a = 1, b: number)`) is treated as required for CLI purposes
  const cliOptional = positionalParams.map((param, i) => positionalParams.slice(i).every(p => p.optional))

  const tupleScript = `[${params
    .map((param, i) => {
      if (lastIsFlagsObject && i === params.length - 1) return param.typeText // flags object is always passed (possibly empty), so its optionality is irrelevant
      return cliOptional[i] ? `(${param.typeText}) | undefined` : param.typeText
    })
    .join(', ')}]`
  const schema = parseTypeScriptSchema(context, tupleScript) as {items?: unknown[]; minItems?: number}
  if (isNeverSchema(schema) || !Array.isArray(schema.items) || schema.items.length !== params.length) {
    throw new SkippedModuleCommandError(
      `Could not parse the parameter list of "${command.name}" as a tuple: \`${tupleScript}\`. This is likely a bug in trpc-cli's module-commands extractor - please report it.`,
    )
  }

  // the schema's `~standard` validator reads the schema object live, so it's safe to decorate items in place:
  // titles drive the positional argument names (`<left>`/`[right]`), descriptions show up in help
  positionalParams.forEach((param, i) => {
    const item = schema.items![i] as Record<string, unknown>
    item.title = kebabCase(param.name!)
    // an inline comment before the parameter wins over a `@param` tag in the function's jsdoc - it sits next to the type
    const description = parseCliJsdoc(param.description).description || paramTags[param.name!]
    if (description) item.description = description
    if (cliOptional[i]) item.optional = true
  })
  if (lastIsFlagsObject) {
    // a trailing options object declared via an intersection alias (`type Opts = {a} & {b}`) parses to allOf
    // inside the tuple too - flatten it the same way so flag derivation sees a single object schema
    schema.items[params.length - 1] = mergeIntersection(schema.items[params.length - 1])
    // `@param options ...` (the object itself) has no home in help and is dropped; `@param options.force ...` documents a flag
    applyParamTagPropertyDescriptions(schema.items[params.length - 1], params.at(-1)!.name, paramTags)
  }
  // the flags object is always passed (possibly empty), so it's never an optional tuple element - parse-procedure
  // would otherwise treat `minItems` below its index as "the flags object is optional"
  const firstOptional = cliOptional.indexOf(true)
  schema.minItems = lastIsFlagsObject || firstOptional === -1 ? params.length : firstOptional

  applySchemaJsdocMetadata(schema)
  return builder.input(schema as never).handler(({input}) => fn(...(input as unknown[])))
}

/**
 * Parse a single parameter's type annotation text into a schema, with errors that name the parameter. Reused for
 * both the single-object-parameter path (where the schema doubles as the procedure input) and the positional path
 * (where it's used for object-vs-scalar analysis before the combined tuple script is synthesized).
 */
const parseParamSchema = (commandName: string, param: ExtractedParam, context: Record<string, unknown>): unknown => {
  const schema = parseTypeScriptSchema(context, param.typeText)
  if (isNeverSchema(schema)) {
    throw new SkippedModuleCommandError(
      `Could not parse the type of parameter ${describeParam(param)} of "${commandName}": \`${param.typeText}\`. ` +
        `Use a string/number/boolean type, an inline object type literal like \`{foo: string}\`, or a reference to a \`type X = {...}\`/\`interface X {...}\` declared in the same file or imported from a relative file-backed module.`,
    )
  }
  const danglingRefs = collectRefs(schema)
  if (danglingRefs.length > 0) {
    throw new SkippedModuleCommandError(
      `The type of parameter ${describeParam(param)} of "${commandName}" references ${danglingRefs.map(r => JSON.stringify(r)).join(', ')}, which couldn't be resolved. ` +
        `Declare it as \`type X = {...}\` or \`interface X {...}\` in the same file, import it from a relative file-backed module, or inline the type.`,
    )
  }
  return applySchemaJsdocMetadata(flattenIntersection(schema))
}

const parseTypeScriptSchema = (context: Record<string, unknown>, script: string): unknown => {
  try {
    return Type.Script(context as never, script)
  } catch (error) {
    throw new SkippedModuleCommandError(error instanceof Error ? error.message : String(error))
  }
}

/**
 * `type Opts = {a} & {b}` parses to `{allOf: [...]}`, but trpc-cli's flag derivation wants a single top-level object
 * schema - merge object-only intersections into one (preserving validation behavior, since an intersection of plain
 * object schemas is equivalent to the merged object). Anything else (mixed intersections, unions) is returned as-is,
 * and the merged schema gets the original's non-enumerable `~standard` re-attached with the flattened shape exposed
 * for CLI flag derivation.
 */
const flattenIntersection = (schema: unknown): unknown => {
  const flattened = mergeIntersection(schema)
  if (flattened !== schema) {
    const standard = (schema as {'~standard': Record<string, unknown>})['~standard']
    Object.defineProperty(flattened, '~standard', {
      configurable: true,
      enumerable: false,
      value: {...standard, jsonSchema: {input: () => flattened, output: () => flattened}},
    })
  }
  return flattened
}

const mergeIntersection = (schema: unknown): unknown => {
  if (!schema || typeof schema !== 'object' || !Array.isArray((schema as {allOf?: unknown}).allOf)) return schema
  const {allOf, ...rest} = schema as {allOf: unknown[]} & Record<string, unknown>
  const subs = allOf.map(mergeIntersection) as Array<{type?: string; properties?: object; required?: string[]}>
  if (!subs.every(sub => sub && typeof sub === 'object' && sub.type === 'object')) return schema
  const properties = Object.assign({}, ...subs.map(sub => sub.properties || {})) as object
  const required = [...new Set(subs.flatMap(sub => sub.required || []))]
  return {...rest, type: 'object', properties, ...(required.length > 0 ? {required} : {})}
}

const describeParam = (param: ExtractedParam) => JSON.stringify(param.name || param.typeText)

const isObjectSchema = (schema: unknown): boolean =>
  !!schema && typeof schema === 'object' && (schema as {type?: string}).type === 'object'

/**
 * Object-ish schemas that can occupy the flags position: plain objects, plus unions of them (`{a} | {b}` → anyOf,
 * which trpc-cli's flag derivation flattens with incompatible-pair warnings). Intersections are already merged into
 * plain objects by `flattenIntersection` before this check runs.
 */
const isObjectLikeSchema = (schema: unknown): boolean => {
  if (isObjectSchema(schema)) return true
  const {anyOf} = (schema || {}) as {anyOf?: unknown[]}
  return Array.isArray(anyOf) && anyOf.length > 0 && anyOf.every(sub => isObjectLikeSchema(sub))
}

const primitivePositionalTypes = new Set(['string', 'number', 'boolean', 'integer'])

/** strings, numbers, booleans and unions thereof (including literal unions like `'fast' | 'slow'`) can be positional arguments */
const isPrimitiveish = (schema: unknown): boolean => {
  if (!schema || typeof schema !== 'object') return false
  const types = getSchemaTypes(schema as never).filter(type => type !== 'undefined')
  return types.length > 0 && types.every(type => primitivePositionalTypes.has(type))
}

const isArrayOfPrimitives = (schema: unknown): boolean => {
  if (!schema || typeof schema !== 'object') return false
  const {type, items} = schema as {type?: string; items?: unknown}
  return type === 'array' && !Array.isArray(items) && isPrimitiveish(items)
}

// ------------------------------------------------------------------
// Source scanning - shared comment/string awareness
// ------------------------------------------------------------------

interface SourceScan {
  source: string
  /** for each index of the source: true if inside a comment or string/template literal */
  masked: boolean[]
  /** line and block comments in order of appearance, with their raw text */
  comments: Array<{start: number; end: number; text: string}>
}

/**
 * Single pass over source text marking which positions are inside comments or string/template literals, so that
 * regex matches and bracket counting can skip them. Regex literals are not handled (a `/regex with { braces/` could
 * confuse bracket depth) - acceptable for v1, command modules rarely have them at the positions we scan.
 */
const scanSource = (source: string): SourceScan => {
  const masked = Array.from({length: source.length}, () => false)
  const comments: SourceScan['comments'] = []
  let i = 0
  while (i < source.length) {
    const ch = source[i]
    const next = source[i + 1]
    if (ch === '/' && next === '/') {
      const newline = source.indexOf('\n', i)
      const end = newline === -1 ? source.length : newline
      for (let j = i; j < end; j++) masked[j] = true
      comments.push({start: i, end, text: source.slice(i, end)})
      i = end
    } else if (ch === '/' && next === '*') {
      const close = source.indexOf('*/', i + 2)
      const end = close === -1 ? source.length : close + 2
      for (let j = i; j < end; j++) masked[j] = true
      comments.push({start: i, end, text: source.slice(i, end)})
      i = end
    } else if (ch === "'" || ch === '"') {
      const start = i
      i++
      while (i < source.length && source[i] !== ch && source[i] !== '\n') {
        if (source[i] === '\\') i++
        i++
      }
      i++ // past the closing quote
      for (let j = start; j < Math.min(i, source.length); j++) masked[j] = true
    } else if (ch === '`') {
      // mask the whole template, including `${...}` interpolations - we never need to find exports inside them
      const start = i
      i++
      let interpolationDepth = 0
      while (i < source.length) {
        if (source[i] === '\\') {
          i += 2
          continue
        }
        if (interpolationDepth === 0 && source[i] === '`') {
          i++
          break
        }
        if (interpolationDepth === 0 && source[i] === '$' && source[i + 1] === '{') {
          interpolationDepth++
          i += 2
          continue
        }
        if (interpolationDepth > 0 && source[i] === '{') interpolationDepth++
        if (interpolationDepth > 0 && source[i] === '}') interpolationDepth--
        i++
      }
      for (let j = start; j < Math.min(i, source.length); j++) masked[j] = true
    } else {
      i++
    }
  }
  return {source, masked, comments}
}

/** Returns the index just *after* the bracket closing the opening bracket at `start`. Comment/string positions are skipped. */
const findBalancedEnd = (scan: SourceScan, start: number, open: string, close: string): number => {
  const {source} = scan
  let depth = 0
  for (let i = start; i < source.length; i++) {
    if (scan.masked[i]) continue
    if (close === '>' && source[i] === '>' && source[i - 1] === '=') continue // the `>` of `=>` in e.g. `<T extends () => void>`
    if (source[i] === open) depth++
    else if (source[i] === close) {
      depth--
      if (depth === 0) return i + 1
    }
  }
  throw new Error(`Unbalanced \`${open}${close}\` starting at index ${start} of module source`)
}

/**
 * Returns the index just after the end of a type-alias right-hand side starting at `start`: the first depth-0 `;`,
 * or a depth-0 newline that doesn't continue the type expression (an adjacent significant `=`/`|`/`&` on either
 * side of the newline means it continues - covering multi-line unions/intersections with leading or trailing
 * operators). Tracks `{}[]()<>` depth with the usual exception for the `>` of `=>`.
 */
const findTypeAliasEnd = (scan: SourceScan, start: number): number => {
  const {source} = scan
  const isComment = (i: number) => scan.comments.some(c => i >= c.start && i < c.end)
  const nextSignificant = (from: number): string => {
    for (let j = from; j < source.length; j++) {
      if (/\s/.test(source[j])) continue
      if (scan.masked[j] && isComment(j)) continue
      return source[j]
    }
    return ''
  }
  let depth = 0
  let lastSignificant = '='
  for (let i = start; i < source.length; i++) {
    const ch = source[i]
    if (scan.masked[i]) {
      if (!isComment(i)) lastSignificant = '"' // string literal contents - significant, but never a continuation operator
      continue
    }
    if (ch === ';' && depth === 0) return i
    if (ch === '\n' && depth === 0) {
      const continues = /[=|&]/.test(lastSignificant) || /[|&]/.test(nextSignificant(i + 1))
      if (!continues) return i
    }
    if (ch === '{' || ch === '[' || ch === '(' || ch === '<') depth++
    else if (ch === '}' || ch === ']' || ch === ')') depth--
    else if (ch === '>' && source[i - 1] !== '=') depth--
    if (!/\s/.test(ch)) lastSignificant = ch
  }
  return source.length
}

/** Finds the cleaned text of the nearest preceding jsdoc block comment, skipping whitespace and any intervening line comments. */
const jsdocBefore = (scan: SourceScan, index: number): string | undefined => {
  const {source} = scan
  let i = index - 1
  let comment: SourceScan['comments'][number] | undefined
  while (true) {
    while (i >= 0 && /\s/.test(source[i])) i--
    comment = scan.comments.find(c => c.end === i + 1)
    if (!comment) return undefined
    if (comment.text.startsWith('/**')) break
    i = comment.start - 1 // a non-jsdoc comment (e.g. `// eslint-disable...`) - keep looking above it
  }
  return cleanJsdoc(comment.text)
}

/** Strips the `/**`, `*\/` and leading-`*` decorations from a jsdoc comment's raw text. */
const cleanJsdoc = (text: string): string | undefined => {
  const cleaned = text
    .replace(/^\/\*\*/, '')
    .replace(/\*\/$/, '')
    .split('\n')
    .map(line => line.replace(/^\s*\*? ?/, '').trimEnd())
    .join('\n')
    .trim()
  return cleaned || undefined
}

interface CliJsdoc {
  /** the free text before the first `@tag` line - what a command/argument/flag description is made of */
  description: string | undefined
  /** `@alias x` tags */
  aliases: string[]
  /**
   * `@param name description` tags keyed by name. `@param {type} name`, `@param name - description` and
   * `@param [name]` spellings are accepted (the jsdoc type is ignored - the TypeScript annotation is the source of
   * truth). Dotted names (`@param options.force ...`) are kept as-is; they document a property of an object parameter.
   */
  params: Record<string, string>
}

/**
 * Split cleaned jsdoc text the way jsdoc tooling does: the description is everything up to the first line that
 * starts with an `@tag`, and each tag runs until the next one. `@alias` and `@param` are interpreted; every other
 * tag (`@returns`, `@example`, `@see`, `@deprecated`, ...) is for documentation tooling, not CLI help, and is dropped.
 */
const parseCliJsdoc = (text: string | undefined): CliJsdoc => {
  const doc: CliJsdoc = {description: undefined, aliases: [], params: {}}
  if (!text) return doc
  const blocks: string[][] = [[]]
  for (const line of text.split('\n')) {
    if (/^\s*@[a-z]/i.test(line)) blocks.push([])
    blocks.at(-1)!.push(line)
  }
  const [descriptionLines, ...tagBlocks] = blocks
  doc.description = descriptionLines.join('\n').trim() || undefined
  for (const tagLines of tagBlocks) {
    const [, tag, body] = tagLines
      .join('\n')
      .trim()
      .match(/^@(\w+)\s*([\s\S]*)$/)!
    if (tag === 'alias') {
      const alias = body.split('\n')[0].trim()
      if (alias) doc.aliases.push(alias)
    } else if (tag === 'param' || tag === 'arg' || tag === 'argument') {
      const param = parseParamTag(body)
      if (param) doc.params[param.name] = param.description
    }
  }
  return doc
}

/** Parses the body of a `@param` tag: an optional `{type}`, the (possibly `[bracketed]`, possibly dotted) name, an optional `-`, then the description. */
const parseParamTag = (body: string): {name: string; description: string} | undefined => {
  let rest = body
  if (rest.startsWith('{')) {
    let depth = 0
    let i = 0
    for (; i < rest.length; i++) {
      if (rest[i] === '{') depth++
      else if (rest[i] === '}' && --depth === 0) break
    }
    rest = rest.slice(i + 1).trimStart()
  }
  // the optional `-` separator must be followed by whitespace, so a description starting with a hyphen (`-5 means negative`) keeps it
  const match = rest.match(/^\[?([\w$.]+)(?:=[^\]]*)?\]?(?:[ \t]+-)?(?:\s+([\s\S]*))?$/)
  if (!match) return undefined
  const description = (match[2] || '')
    .split('\n')
    .map(line => line.trim())
    .join('\n')
    .trim()
  return description ? {name: match[1], description} : undefined
}

/**
 * Apply `@param <paramName>.<property> description` tags from a function's jsdoc to the properties of the object
 * parameter's schema (one level deep, in every union branch), where the property doesn't already have a description
 * from its own jsdoc. Property jsdoc wins because it sits next to the type it documents.
 */
const applyParamTagPropertyDescriptions = (
  schema: unknown,
  paramName: string | undefined,
  params: Record<string, string>,
): void => {
  if (!paramName) return
  const prefix = `${paramName}.`
  const entries = Object.entries(params).filter(([key]) => key.startsWith(prefix))
  if (entries.length === 0) return
  const visit = (node: unknown) => {
    if (!node || typeof node !== 'object') return
    const record = node as {
      properties?: Record<string, unknown>
      anyOf?: unknown[]
      oneOf?: unknown[]
      allOf?: unknown[]
    }
    for (const [key, description] of entries) {
      const property = record.properties?.[key.slice(prefix.length)] as Record<string, unknown> | undefined
      if (property && typeof property === 'object' && !property.description) property.description = description
    }
    ;[...(record.anyOf || []), ...(record.oneOf || []), ...(record.allOf || [])].forEach(visit)
  }
  visit(schema)
}

const applySchemaJsdocMetadata = (schema: unknown): unknown => {
  if (!schema || typeof schema !== 'object') return schema
  const record = schema as Record<string, unknown>
  if (typeof record.description === 'string') {
    const doc = parseCliJsdoc(record.description)
    if (doc.description) record.description = doc.description
    else delete record.description
    if (doc.aliases.length > 0) record.alias = doc.aliases[0]
  }
  for (const value of Object.values(record)) {
    if (Array.isArray(value)) value.forEach(applySchemaJsdocMetadata)
    else applySchemaJsdocMetadata(value)
  }
  return schema
}

// ------------------------------------------------------------------
// Command extraction
// ------------------------------------------------------------------

const extractModuleReexports = (source: string): ModuleReexport[] => {
  const scan = scanSource(source)
  const reexports: Array<ModuleReexport & {position: number}> = []

  for (const match of source.matchAll(/(?<![.\w$])export\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s+(['"])([^'"]+)\2/g)) {
    if (scan.masked[match.index]) continue
    reexports.push({kind: 'namespace', name: match[1], specifier: match[3], position: match.index})
  }

  for (const match of source.matchAll(/(?<![.\w$])export\s+\*\s+from\s+(['"])([^'"]+)\1/g)) {
    if (scan.masked[match.index]) continue
    reexports.push({kind: 'all', name: undefined, specifier: match[2], position: match.index})
  }

  for (const match of source.matchAll(/(?<![.\w$])export\s+(type\s+)?\{([^}]+)\}\s+from\s+(['"])([^'"]+)\3/g)) {
    if (scan.masked[match.index]) continue
    const names = parseNamedSpecifiers(match[2], Boolean(match[1]))
      .filter(specifier => !specifier.typeOnly)
      .map(({imported, exported}) => ({imported, exported}))
    if (names.length > 0) {
      reexports.push({kind: 'named', name: undefined, names, specifier: match[4], position: match.index})
    }
  }

  reexports.sort((a, b) => a.position - b.position)
  return reexports.map(({kind, name, names, specifier}) => ({kind, name, names, specifier}))
}

const parseNamedSpecifiers = (
  raw: string,
  typeOnlyExport: boolean,
): Array<{imported: string; exported: string; typeOnly: boolean}> =>
  raw
    .split(',')
    .map(part => part.trim())
    .filter(Boolean)
    .flatMap(part => {
      const typeOnly = typeOnlyExport || part.startsWith('type ')
      const text = part.replace(/^type\s+/, '').trim()
      const match = text.match(/^([A-Za-z_$][\w$]*|default)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/)
      if (!match) return []
      return [{imported: match[1], exported: match[2] || match[1], typeOnly}]
    })

/**
 * @experimental Extract exported function declarations from module source text: name, preceding jsdoc, and the full
 * parameter list (names, optionality, type annotation text, inline jsdoc). Supports `export function f(...)`,
 * `export async function f(...)`, `export const f = (...) => ...` (parenthesized arrows only), and
 * `export default function f(...)` (or an anonymous default function, which becomes a command named `default`).
 * Returns one command per export name: TS function overloads extract once per declaration, and all the overload
 * *signatures* become the command's calling conventions (see the grouping note inline).
 */
export const extractModuleCommands = (scan: SourceScan): ExtractedCommand[] => {
  const declarations: Array<{
    name: string
    exportName: string
    default: boolean
    position: number
    /** false for a body-less TS overload signature (`export function f(...): R` with no `{...}` after it) */
    hasBody: boolean
    paramList: string
    description: string | undefined
  }> = []

  const declarationPatterns = [
    // `function` declarations can be body-less overload signatures - detect which, for the dedupe below
    {
      pattern: /(?<![.\w$])export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*/g,
      canBeSignature: true,
      default: false,
    },
    {
      pattern: /(?<![.\w$])export\s+default\s+(?:async\s+)?function(?:\s+([A-Za-z_$][\w$]*))?\s*/g,
      canBeSignature: true,
      default: true,
    },
    // a `const` initializer is always an implementation - overload syntax doesn't exist for arrow functions
    {
      pattern: /(?<![.\w$])export\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?=\()/g,
      canBeSignature: false,
      default: false,
    },
  ]
  const {source} = scan
  for (const {pattern, canBeSignature, default: defaultExport} of declarationPatterns) {
    for (const match of source.matchAll(pattern)) {
      if (scan.masked[match.index]) continue
      const name = match[1] || 'default'
      let parenIndex = match.index + match[0].length
      if (source[parenIndex] === '<') parenIndex = findBalancedEnd(scan, parenIndex, '<', '>') // skip generic type params
      while (parenIndex < source.length && /\s/.test(source[parenIndex])) parenIndex++
      if (source[parenIndex] !== '(') continue // not a function shape after all, e.g. `export function` matched inside something weird
      const parenEnd = findBalancedEnd(scan, parenIndex, '(', ')')
      declarations.push({
        name,
        exportName: defaultExport ? 'default' : name,
        default: defaultExport,
        position: match.index,
        hasBody: canBeSignature ? hasFunctionBody(scan, parenEnd) : true,
        paramList: source.slice(parenIndex + 1, parenEnd - 1),
        description: jsdocBefore(scan, match.index),
      })
    }
  }
  // matchAll over two patterns can't interleave, so restore source order - it determines command order in --help
  declarations.sort((a, b) => a.position - b.position)

  // One command per name - with special handling for TS function overloads, which extract once per declaration:
  // the body-less *signatures* come first and the *implementation* (whose params are typically widened, e.g.
  // `options: any`) last. TS resolves calls against the signatures in order, so when signatures exist they ALL
  // become the command's calling conventions, in declaration order: buildOverloadedProcedure turns
  // single-object-parameter overloads into alternate flag sets validated first-match; any other overload shape
  // falls back to just the first signature. The implementation signature is never used, so an unannotated
  // implementation (`function f(options) {`) can't poison a command whose signatures are fine, and signatures
  // whose params fail to parse are dropped individually rather than sinking the whole command.
  return groupOverloadDeclarations(declarations).flatMap(({winners, implementation}): ExtractedCommand[] => {
    const overloads = winners.flatMap(declaration => {
      const params = tryParseParams(declaration.name, declaration.paramList)
      return params ? [{description: declaration.description, params}] : []
    })
    if (overloads.length === 0) return []
    const {name, exportName, default: defaultExport, position} = winners[0]
    return [
      {
        name,
        exportName,
        default: defaultExport,
        position,
        description: overloads[0].description,
        params: overloads[0].params,
        ...(overloads.length > 1 ? {overloads, implementationDescription: implementation?.description} : {}),
      },
    ]
  })
}

/**
 * Group declarations sharing a name. `winners` are the declarations defining the command's calling convention(s):
 * all body-less overload signatures when any exist (in declaration order), otherwise the first implementation.
 * The implementation declaration is kept separately - its jsdoc can describe an overloaded command as a whole.
 */
const groupOverloadDeclarations = <D extends {name: string; hasBody: boolean; description?: string | undefined}>(
  declarations: D[],
): Array<{winners: D[]; implementation: D | undefined}> => {
  const groups = new Map<string, D[]>()
  for (const declaration of declarations) {
    const group = groups.get(declaration.name)
    if (group) group.push(declaration)
    else groups.set(declaration.name, [declaration])
  }
  return [...groups.values()].map(group => {
    const signatures = group.filter(declaration => !declaration.hasBody)
    return {
      winners: signatures.length > 0 ? signatures : group.slice(0, 1),
      implementation: group.find(declaration => declaration.hasBody),
    }
  })
}

export const extractModuleClasses = (scan: SourceScan): ExtractedClass[] => {
  const {source} = scan
  const classes: ExtractedClass[] = []

  const patterns = [
    {pattern: /(?<![.\w$])export\s+class\s+([A-Za-z_$][\w$]*)\s*/g, default: false},
    {pattern: /(?<![.\w$])export\s+default\s+class(?:\s+([A-Za-z_$][\w$]*))?\s*/g, default: true},
  ]

  for (const {pattern, default: defaultExport} of patterns) {
    for (const match of source.matchAll(pattern)) {
      if (scan.masked[match.index]) continue
      const name = match[1] || 'default'
      const exportName = defaultExport ? 'default' : name
      let headerIndex = match.index + match[0].length
      if (source[headerIndex] === '<') headerIndex = findBalancedEnd(scan, headerIndex, '<', '>')
      const braceIndex = findNextUnmasked(scan, headerIndex, '{')
      const header = source.slice(headerIndex, braceIndex)
      const hasBaseClass = /\bextends\b/.test(header)

      const classEnd = findBalancedEnd(scan, braceIndex, '{', '}')
      const {methodDeclarations, hasConstructorParameters, hasZeroArgConstructor} = extractClassMethodDeclarations(
        scan,
        braceIndex + 1,
        classEnd - 1,
      )
      if (hasConstructorParameters) continue
      if (hasBaseClass && !hasZeroArgConstructor) continue
      if (methodDeclarations.length === 0) continue
      const methods = methodDeclarations.flatMap(
        ({methodName, position, signatures, implementationDescription}): ExtractedCommand[] => {
          const overloads = signatures.flatMap(signature => {
            const params = tryParseParams(`${name}.${methodName}`, signature.paramList)
            return params ? [{description: signature.description, params}] : []
          })
          if (overloads.length === 0) return []
          return [
            {
              name: methodName,
              exportName: methodName,
              default: false,
              position,
              description: overloads[0].description,
              params: overloads[0].params,
              ...(overloads.length > 1 ? {overloads, implementationDescription} : {}),
            },
          ]
        },
      )
      if (methods.length === 0) continue
      classes.push({name, exportName, default: defaultExport, methods})
    }
  }

  return classes
}

const findNextUnmasked = (scan: SourceScan, start: number, char: string): number => {
  const {source} = scan
  for (let i = start; i < source.length; i++) {
    if (!scan.masked[i] && source[i] === char) return i
  }
  throw new Error(`Could not find \`${char}\` after index ${start} of module source`)
}

const extractClassMethodDeclarations = (
  scan: SourceScan,
  bodyStart: number,
  bodyEnd: number,
): {
  methodDeclarations: Array<{
    methodName: string
    position: number
    /** one per body-less overload signature, or a single entry for a plain method - same rule as `groupOverloadDeclarations` */
    signatures: Array<{description: string | undefined; paramList: string}>
    /** jsdoc of the overload implementation, when the method is overloaded */
    implementationDescription: string | undefined
  }>
  hasConstructorParameters: boolean
  hasZeroArgConstructor: boolean
} => {
  const {source} = scan
  const body = source.slice(bodyStart, bodyEnd)
  const declarations: Array<{
    name: string
    position: number
    hasBody: boolean
    paramList: string
    description: string | undefined
  }> = []
  let hasConstructorParameters = false
  let hasZeroArgConstructor = false

  const pattern = /(?<![.\w$#])(?:(public|private|protected)\s+)?(?:(static)\s+)?(?:(async)\s+)?([A-Za-z_$][\w$]*)\s*/g
  for (const match of body.matchAll(pattern)) {
    const absoluteIndex = bodyStart + match.index
    if (scan.masked[absoluteIndex]) continue
    if (!isTopLevelClassMember(scan, bodyStart, absoluteIndex)) continue

    const visibility = match[1]
    const staticModifier = match[2]
    const name = match[4]
    const beforeMatch = source.slice(bodyStart, absoluteIndex).trimEnd()
    const declarationStart = source.slice(absoluteIndex, bodyStart + match.index + match[0].length).trimStart()
    if (/\b(?:get|set)$/.test(beforeMatch)) continue
    if (
      visibility === 'private' ||
      visibility === 'protected' ||
      staticModifier ||
      declarationStart.startsWith('get ')
    ) {
      continue
    }
    if (declarationStart.startsWith('set ')) continue

    let parenIndex = bodyStart + match.index + match[0].length
    if (source[parenIndex] === '<') parenIndex = findBalancedEnd(scan, parenIndex, '<', '>')
    while (parenIndex < source.length && /\s/.test(source[parenIndex])) parenIndex++
    if (source[parenIndex] !== '(') continue

    const parenEnd = findBalancedEnd(scan, parenIndex, '(', ')')
    const paramList = source.slice(parenIndex + 1, parenEnd - 1)
    if (name === 'constructor') {
      if (paramList.trim()) hasConstructorParameters = true
      else hasZeroArgConstructor = true
      continue
    }

    declarations.push({
      name,
      position: absoluteIndex,
      hasBody: hasFunctionBody(scan, parenEnd),
      paramList,
      description: jsdocBefore(scan, absoluteIndex),
    })
  }

  declarations.sort((a, b) => a.position - b.position)

  return {
    hasConstructorParameters,
    hasZeroArgConstructor,
    methodDeclarations: groupOverloadDeclarations(declarations).map(({winners, implementation}) => ({
      methodName: winners[0].name,
      position: winners[0].position,
      signatures: winners.map(({description, paramList}) => ({description, paramList})),
      implementationDescription: implementation?.description,
    })),
  }
}

const isTopLevelClassMember = (scan: SourceScan, bodyStart: number, index: number): boolean => {
  const {source} = scan
  let depth = 0
  for (let i = bodyStart; i < index; i++) {
    if (scan.masked[i]) continue
    if (source[i] === '{') depth++
    else if (source[i] === '}') depth--
  }
  return depth === 0
}

/**
 * Determine whether a `function` declaration whose parameter list closes at `parenEnd` has a `{...}` body, or is a
 * body-less TS overload signature (`export function f(...): R` ending at a newline or semicolon). An optional
 * return-type annotation is scanned through with bracket-depth tracking; a depth-0 `{` is the body unless it sits
 * where an object type literal can start (after `:`, `|`, `&`, `?`, or the `>` of `=>`). Pragmatic rather than a
 * full type parser - an exotic depth-0 return type (e.g. a conditional type with a bare `extends {...}`) could
 * misclassify, which only matters when the same name is declared more than once.
 */
const hasFunctionBody = (scan: SourceScan, parenEnd: number): boolean => {
  const {source} = scan
  const isComment = (i: number) => scan.comments.some(c => i >= c.start && i < c.end)
  const nextSignificant = (from: number): string => {
    for (let j = from; j < source.length; j++) {
      if (/\s/.test(source[j])) continue
      if (scan.masked[j] && isComment(j)) continue
      return source[j]
    }
    return ''
  }
  let depth = 0
  let lastSignificant = ')'
  let prevSignificant = ''
  for (let i = parenEnd; i < source.length; i++) {
    const ch = source[i]
    if (scan.masked[i]) {
      if (!isComment(i)) {
        // string/template contents (e.g. a template-literal return type) - significant, but never an operator
        prevSignificant = lastSignificant
        lastSignificant = '"'
      }
      continue
    }
    if (depth === 0) {
      if (ch === ';') return false
      if (ch === '\n') {
        // same statement-end logic as findTypeAliasEnd, plus `{` on the next line for Allman-style bodies
        const continues = /[:=|&]/.test(lastSignificant) || /[{|&]/.test(nextSignificant(i + 1))
        if (!continues) return false
      }
      if (ch === '{' && !/[:|&?]/.test(lastSignificant) && !(lastSignificant === '>' && prevSignificant === '=')) {
        return true
      }
    }
    if (ch === '{' || ch === '[' || ch === '(' || ch === '<') depth++
    else if (ch === '}' || ch === ']' || ch === ')') depth--
    else if (ch === '>' && source[i - 1] !== '=') depth--
    if (!/\s/.test(ch)) {
      prevSignificant = lastSignificant
      lastSignificant = ch
    }
  }
  return false
}

/**
 * Given the text between a function's parens, parse the full parameter list: names, optional markers
 * (`right?: number`), default values (`right: number = 3` - treated as optional), type annotation text, and inline
 * jsdoc (`/** doc *\/ left: number`). `<`/`>` are tracked as brackets (so `Map<string, number>` survives the
 * top-level-comma check) except the `>` of `=>`.
 */
const tryParseParams = (functionName: string, paramList: string): ExtractedParam[] | undefined => {
  try {
    return parseParams(functionName, paramList)
  } catch (error) {
    if (error instanceof SkippedModuleCommandError) return undefined
    throw error
  }
}

/** split a parameter list at top-level commas into [start, end) segments, one per parameter */
const splitTopLevelCommas = (scan: SourceScan): Array<{start: number; end: number}> => {
  const {source: paramList} = scan
  const segments: Array<{start: number; end: number}> = []
  let depth = 0
  let segmentStart = 0
  for (let i = 0; i < paramList.length; i++) {
    if (scan.masked[i]) continue
    const ch = paramList[i]
    if (ch === '(' || ch === '{' || ch === '[' || ch === '<') depth++
    else if (ch === ')' || ch === '}' || ch === ']') depth--
    else if (ch === '>' && paramList[i - 1] !== '=') depth--
    else if (depth === 0 && ch === ',') {
      segments.push({start: segmentStart, end: i})
      segmentStart = i + 1
    }
  }
  segments.push({start: segmentStart, end: paramList.length})
  return segments
}

const parseParams = (functionName: string, paramList: string): ExtractedParam[] => {
  const scan = scanSource(paramList)

  return splitTopLevelCommas(scan).flatMap((segment): ExtractedParam[] => {
    if (!paramList.slice(segment.start, segment.end).trim()) return [] // no parameters at all, or a trailing comma

    // find the top-level `:` (start of the type annotation) and `=` (start of a default value) within the segment
    let colon = -1
    let eq = -1
    let depth = 0
    for (let i = segment.start; i < segment.end; i++) {
      if (scan.masked[i]) continue
      const ch = paramList[i]
      if (ch === '(' || ch === '{' || ch === '[' || ch === '<') depth++
      else if (ch === ')' || ch === '}' || ch === ']') depth--
      else if (ch === '>' && paramList[i - 1] !== '=') depth--
      else if (depth === 0 && colon === -1 && eq === -1 && ch === ':') colon = i
      else if (depth === 0 && eq === -1 && ch === '=' && paramList[i + 1] !== '>') eq = i
    }

    const nameEnd = [colon, eq, segment.end].find(index => index !== -1)!
    const description = scan.comments
      .filter(c => c.start >= segment.start && c.end <= nameEnd && c.text.startsWith('/**'))
      .map(c => cleanJsdoc(c.text))
      .find(Boolean)
    const nameText = paramList
      .slice(segment.start, nameEnd)
      .replaceAll(/\/\*[\S\s]*?\*\//g, '') // drop inline comments - they're the description, not part of the name
      .trim()

    if (nameText.startsWith('...')) {
      const annotation = colon === -1 ? 'string[]' : paramList.slice(colon + 1, segment.end).trim()
      throw new SkippedModuleCommandError(
        `Parameter "${nameText}" of "${functionName}" is a rest parameter, which isn't supported. Use an explicitly-typed array parameter (e.g. \`${nameText.slice(3)}: ${annotation}\`, which becomes a variadic positional argument), or move it into a trailing options object.`,
      )
    }
    const destructured = nameText.startsWith('{') || nameText.startsWith('[')
    const optionalMarker = nameText.endsWith('?')
    const name = destructured ? undefined : nameText.replace(/\?$/, '').trim()

    if (colon === -1) {
      throw new SkippedModuleCommandError(
        `Parameter "${nameText}" of "${functionName}" has no type annotation. Annotate it, e.g. \`(${nameText}: string)\` or \`(${nameText}: {someFlag: string})\`.`,
      )
    }
    const typeText = paramList.slice(colon + 1, eq === -1 ? segment.end : eq).trim()
    return [{name, optional: optionalMarker || eq !== -1, typeText, description, destructured}]
  })
}

// ------------------------------------------------------------------
// Type declaration context
// ------------------------------------------------------------------

const buildFileDeclarationContext = async (
  resolved: FileSourceModule,
  loader: ModuleFileLoader,
): Promise<Record<string, unknown>> => {
  const parts = await collectTypeContextParts(resolved, loader, new Set<string>())
  return buildDeclarationContext([...parts.sources, ...parts.aliases].join('\n'))
}

const collectTypeContextParts = async (
  resolved: FileSourceModule,
  loader: ModuleFileLoader,
  seen: Set<string>,
): Promise<{sources: string[]; aliases: string[]}> => {
  if (seen.has(resolved.filepath)) return {sources: [], aliases: []}
  seen.add(resolved.filepath)

  const sources: string[] = []
  const aliases: string[] = []
  for (const typeImport of extractModuleTypeImports(resolved.source)) {
    if (!typeImport.specifier.startsWith('./') && !typeImport.specifier.startsWith('../')) continue
    const child = await loader.loadSourceSpecifier(resolved.filepath, typeImport.specifier)
    const childParts = await collectTypeContextParts(child, loader, seen)
    sources.push(...childParts.sources)
    aliases.push(...childParts.aliases)
    for (const {imported, local} of typeImport.imports) {
      if (imported !== local) aliases.push(`type ${local} = ${imported}`)
    }
  }
  sources.push(resolved.source)

  return {sources, aliases}
}

const extractModuleTypeImports = (
  source: string,
): Array<{specifier: string; imports: Array<{imported: string; local: string}>}> => {
  const scan = scanSource(source)
  const imports: Array<{specifier: string; imports: Array<{imported: string; local: string}>; position: number}> = []

  for (const match of source.matchAll(/(?<![.\w$])import\s+type\s+\{([^}]+)\}\s+from\s+(['"])([^'"]+)\2/g)) {
    if (scan.masked[match.index]) continue
    imports.push({
      specifier: match[3],
      imports: parseNamedSpecifiers(match[1], true).map(({imported, exported}) => ({imported, local: exported})),
      position: match.index,
    })
  }

  for (const match of source.matchAll(/(?<![.\w$])import\s+\{([^}]+)\}\s+from\s+(['"])([^'"]+)\2/g)) {
    if (scan.masked[match.index]) continue
    const typeSpecifiers = parseNamedSpecifiers(match[1], false).filter(specifier => specifier.typeOnly)
    if (typeSpecifiers.length === 0) continue
    imports.push({
      specifier: match[3],
      imports: typeSpecifiers.map(({imported, exported}) => ({imported, local: exported})),
      position: match.index,
    })
  }

  imports.sort((a, b) => a.position - b.position)
  return imports.map(({specifier, imports: importedNames}) => ({specifier, imports: importedNames}))
}

/**
 * Extract `type X = ...` and `interface X {...}` declarations from the source and parse them into a record of
 * schemas, used as the `Type.Script` context so function parameters can reference named types. Tries a single
 * joined script first (which resolves cross-references in any declaration order); if any declaration fails to
 * parse - one bad declaration poisons a joined script - falls back to iterative per-declaration parsing so the
 * good declarations still resolve.
 */
const buildDeclarationContext = (source: string): Record<string, unknown> => {
  const scan = scanSource(source)
  const declarations: Array<{name: string; text: string}> = []

  for (const match of source.matchAll(/(?<![.\w$])(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*=\s*/g)) {
    if (scan.masked[match.index]) continue
    const start = match.index + match[0].length
    // slice to the end of the whole statement, not just the first balanced `{}` - aliases like
    // `type Opts = {mode: string} & {extra: string}` or multi-line unions must keep their tails,
    // otherwise the schema would silently lose properties/variants
    const end = findTypeAliasEnd(scan, start)
    const text = `type ${match[1]} = ${source.slice(start, end).replace(/;\s*$/, '').trim()}`
    declarations.push({name: match[1], text})
  }
  for (const match of source.matchAll(
    /(?<![.\w$])(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)(\s+extends\s+[^{]+)?\s*\{/g,
  )) {
    if (scan.masked[match.index]) continue
    const braceIndex = match.index + match[0].length - 1
    const end = findBalancedEnd(scan, braceIndex, '{', '}')
    declarations.push({name: match[1], text: source.slice(match.index, end).replace(/^export\s+/, '')})
  }

  if (declarations.length === 0) return {}

  const looksComplete = (record: unknown): record is Record<string, unknown> =>
    !!record && typeof record === 'object' && declarations.every(d => d.name in record)

  const joined = Type.Script(declarations.map(d => d.text).join('\n')) as unknown
  if (looksComplete(joined)) return joined

  // fall back: parse declarations individually (skipping bad ones), iterating so cross-references resolve regardless of order
  let context: Record<string, unknown> = {}
  const passes = Math.min(declarations.length, 10)
  for (let pass = 0; pass < passes; pass++) {
    for (const declaration of declarations) {
      try {
        const parsed = Type.Script(context as never, declaration.text) as unknown
        if (parsed && typeof parsed === 'object' && declaration.name in parsed) {
          context = {...context, [declaration.name]: (parsed as Record<string, unknown>)[declaration.name]}
        }
      } catch {
        // a declaration the parser can't handle at all - leave it out; references to it will surface as dangling $refs
      }
    }
  }
  return context
}

// ------------------------------------------------------------------
// Schema sanity checks
// ------------------------------------------------------------------

/** `Type.Script` returns `{not: {}}` (Never) rather than throwing when it can't parse the input */
const isNeverSchema = (schema: unknown): boolean => {
  if (!schema || typeof schema !== 'object' || !('not' in schema)) return false
  const not = (schema as {not: unknown}).not
  return !!not && typeof not === 'object' && Object.keys(not).length === 0
}

/** Unknown named types don't throw either - they're embedded as `{$ref: 'TheName'}`. Walk the schema and collect them. */
const collectRefs = (schema: unknown, found: string[] = []): string[] => {
  if (!schema || typeof schema !== 'object') return found
  for (const [key, value] of Object.entries(schema)) {
    if (key === '$ref' && typeof value === 'string') found.push(value)
    else collectRefs(value, found)
  }
  return [...new Set(found)]
}
