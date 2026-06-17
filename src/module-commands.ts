/**
 * @experimental Derive a CLI from a plain TypeScript module of exported functions - no schema library, no router.
 *
 * Runtime functions carry no type information, so this works from two inputs: the module's *source text* (to extract
 * each exported function's parameter types and jsdoc) and its *live exports* (to actually call the functions).
 * The extracted parameter type text is handed to the vendored `Type.Script` (see ./typebox), which turns it into a
 * JSON Schema - including jsdoc comments as property descriptions - with a `~standard` validator attached. Each
 * function becomes a norpc procedure, so the rest of trpc-cli treats the module like any other router: leading
 * scalar parameters become positional arguments and a trailing object-literal parameter becomes flags (the same
 * convention as trpc-cli's tuple inputs), while single-object-parameter functions are flags-only.
 *
 * The source "parser" here is deliberately a lightweight hand-rolled extractor, not the TypeScript compiler API:
 * it only needs to find exported function declarations, the jsdoc immediately preceding them, and each parameter's
 * name + balanced `{...}` (or named-reference) type annotation text. The heavy lifting - turning type syntax into
 * JSON Schema - is all `Type.Script`.
 */
import {t} from './norpc.js'
import {NorpcProcedureLike, NorpcRouterLike} from './parse-router.js'
import Type from './typebox/index.js'
import {getSchemaTypes, kebabCase} from './util.js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any

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
  /** cleaned jsdoc text from the comment immediately preceding the export - becomes the command description */
  description: string | undefined
  /** the function's parameters, in declaration order. Empty = command with no args */
  params: ExtractedParam[]
}

/** A parameter extracted from a function declaration's parameter list. */
export interface ExtractedParam {
  /** the parameter name, e.g. `left` - becomes the (kebab-cased) positional argument name. Undefined for destructured patterns like `{force}` */
  name: string | undefined
  /** true if marked with `?` or given a default value - trailing optional scalars become optional positionals */
  optional: boolean
  /** raw text of the type annotation, e.g. `number` or `{force?: boolean}` */
  typeText: string
  /** cleaned jsdoc from an inline block comment before the parameter, e.g. `(/** the left operand *\/ left: number)` - becomes the positional description */
  description: string | undefined
  /** true if the parameter is a destructuring pattern like `{force}` or `[a, b]` */
  destructured: boolean
}

/**
 * @experimental Resolve a `CliModuleInput` to a norpc router. The string/URL forms read the file and dynamically
 * import it - `node:` modules are imported lazily here so this file stays safe to bundle for non-node targets.
 */
export const moduleToRouter = async (moduleInput: CliModuleInput): Promise<NorpcRouterLike> => {
  const resolved =
    typeof moduleInput === 'string' || moduleInput instanceof URL ? await loadModuleFromPath(moduleInput) : moduleInput
  return buildRouterFromModule(resolved)
}

const loadModuleFromPath = async (filepath: string | URL) => {
  const [fs, path, url] = await Promise.all([
    import('node:fs/promises'),
    // eslint-disable-next-line unicorn/import-style -- dynamic import: there's no "default import" syntax to use here
    import('node:path').then(m => m.default),
    import('node:url'),
  ])
  // a URL (`new URL('./commands.ts', import.meta.url)`) pins the module to the importing file; a plain string is cwd-relative
  const fullpath = typeof filepath === 'string' ? path.resolve(process.cwd(), filepath) : url.fileURLToPath(filepath)
  const source = await fs.readFile(fullpath, 'utf8').catch((e: unknown) => {
    throw new Error(`Could not read module source at ${fullpath}`, {cause: e})
  })
  const exports = (await import(url.pathToFileURL(fullpath).href).catch((e: unknown) => {
    throw new Error(
      `Could not import module at ${fullpath}. For TypeScript modules, run under tsx, bun, deno, or node >=22.18 (which strip types natively).`,
      {cause: e},
    )
  })) as Record<string, unknown>
  return {source, exports: {...exports}}
}

/**
 * @experimental Build a norpc router from a module's source text + live exports. Exported functions become
 * procedures: source order determines command order, function jsdoc becomes the command description, and parameter
 * type annotations (inline literals, or references to a `type`/`interface` declared in the same file) are parsed by
 * the vendored `Type.Script` into the input schema. Leading scalar parameters become positional arguments; a
 * trailing object parameter becomes flags.
 */
export const buildRouterFromModule = (resolved: {
  source: string
  exports: Record<string, unknown>
}): NorpcRouterLike => {
  const {source, exports} = resolved
  const commands = extractModuleCommands(source)
  const context = buildDeclarationContext(source)

  const procedures: Record<string, NorpcProcedureLike> = {}
  for (const command of commands) {
    const fn = exports[command.exportName]
    if (typeof fn !== 'function') continue // e.g. `export const x = (2 + 3)` - extractor can match non-functions; runtime is the source of truth
    procedures[command.name] = buildProcedure(command, fn as AnyFn, context)
  }

  const unmatched = Object.entries(exports)
    .filter(
      ([name, value]) =>
        typeof value === 'function' && !commands.some(command => command.exportName === name) && !(name in procedures),
    )
    .map(([name]) => name)
  if (unmatched.length > 0) {
    throw new Error(
      `Could not find a parseable declaration for exported function(s) ${unmatched.map(n => JSON.stringify(n)).join(', ')}. ` +
        `Every exported function becomes a command, and must be declared directly in the module source as \`export function name(...)\`, \`export async function name(...)\` or \`export const name = (...) => ...\` - ` +
        `re-exports like \`export {name}\` or \`export * from './helpers.js'\` can't be parsed. ` +
        `If these exports aren't meant to be commands, move them to a separate module that the commands module doesn't re-export.`,
    )
  }
  if (Object.keys(procedures).length === 0) {
    throw new Error(
      `No commands found in module. Export functions with \`export function name(...)\`, \`export async function name(...)\`, \`export const name = (...) => ...\` or \`export default function name(...)\`.`,
    )
  }
  return t.router(procedures)
}

const buildProcedure = (command: ExtractedCommand, fn: AnyFn, context: Record<string, unknown>): NorpcProcedureLike => {
  const meta = {
    ...(command.description ? {description: command.description} : {}),
    ...(command.default ? {default: true} : {}),
  }
  const builder = Object.keys(meta).length > 0 ? t.procedure.meta(meta) : t.procedure
  if (command.params.length === 0) {
    return builder.handler(() => fn())
  }

  const paramSchemas = command.params.map(param => parseParamSchema(command.name, param, context))

  if (command.params.length === 1 && isObjectLikeSchema(paramSchemas[0])) {
    // single object(-union) parameter: everything is a flag, the function receives the validated object directly
    return builder.input(paramSchemas[0] as never).handler(({input}) => fn(input))
  }

  return buildPositionalProcedure(builder, command, fn, context, paramSchemas)
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
  const lastIsFlagsObject = isObjectLikeSchema(paramSchemas.at(-1))
  const positionalParams = lastIsFlagsObject ? params.slice(0, -1) : params

  positionalParams.forEach((param, i) => {
    const where = `Parameter ${i + 1} (${describeParam(param)}) of "${command.name}"`
    if (param.destructured) {
      throw new Error(
        `${where} is a destructuring pattern, which isn't supported for positional arguments. Give the parameter a name, or move it into a trailing options object.`,
      )
    }
    if (isObjectLikeSchema(paramSchemas[i])) {
      throw new Error(
        `${where} is an object type, but only the *last* parameter can be an object - leading parameters become positional arguments and a trailing object parameter maps to flags. Move it to the end, or flatten it into the trailing options object.`,
      )
    }
    if (isArrayOfPrimitives(paramSchemas[i])) {
      if (param.optional) {
        throw new Error(
          `${where} is an optional array. Optional array parameters aren't supported as positional arguments - make it required, or move it into a trailing options object.`,
        )
      }
      return // required array of primitives -> variadic positional, supported by the existing tuple handling
    }
    if (!isPrimitiveish(paramSchemas[i])) {
      throw new Error(
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
  const schema = Type.Script(context as never, tupleScript) as {items?: unknown[]; minItems?: number}
  if (isNeverSchema(schema) || !Array.isArray(schema.items) || schema.items.length !== params.length) {
    throw new Error(
      `Could not parse the parameter list of "${command.name}" as a tuple: \`${tupleScript}\`. This is likely a bug in trpc-cli's module-commands extractor - please report it.`,
    )
  }

  // the schema's `~standard` validator reads the schema object live, so it's safe to decorate items in place:
  // titles drive the positional argument names (`<left>`/`[right]`), descriptions show up in help
  positionalParams.forEach((param, i) => {
    const item = schema.items![i] as Record<string, unknown>
    item.title = kebabCase(param.name!)
    if (param.description) item.description = param.description
    if (cliOptional[i]) item.optional = true
  })
  if (lastIsFlagsObject) {
    // a trailing options object declared via an intersection alias (`type Opts = {a} & {b}`) parses to allOf
    // inside the tuple too - flatten it the same way so flag derivation sees a single object schema
    schema.items[params.length - 1] = mergeIntersection(schema.items[params.length - 1])
  }
  schema.minItems = cliOptional.includes(true) ? cliOptional.indexOf(true) : params.length

  return builder.input(schema as never).handler(({input}) => fn(...(input as unknown[])))
}

/**
 * Parse a single parameter's type annotation text into a schema, with errors that name the parameter. Reused for
 * both the single-object-parameter path (where the schema doubles as the procedure input) and the positional path
 * (where it's used for object-vs-scalar analysis before the combined tuple script is synthesized).
 */
const parseParamSchema = (commandName: string, param: ExtractedParam, context: Record<string, unknown>): unknown => {
  const schema = Type.Script(context as never, param.typeText)
  if (isNeverSchema(schema)) {
    throw new Error(
      `Could not parse the type of parameter ${describeParam(param)} of "${commandName}": \`${param.typeText}\`. ` +
        `Use a string/number/boolean type, an inline object type literal like \`{foo: string}\`, or a reference to a \`type X = {...}\`/\`interface X {...}\` declared in the same file.`,
    )
  }
  const danglingRefs = collectRefs(schema)
  if (danglingRefs.length > 0) {
    throw new Error(
      `The type of parameter ${describeParam(param)} of "${commandName}" references ${danglingRefs.map(r => JSON.stringify(r)).join(', ')}, which couldn't be resolved. ` +
        `Declare it as \`type X = {...}\` or \`interface X {...}\` in the same file, or inline the type.`,
    )
  }
  return flattenIntersection(schema)
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
  return {masked, comments}
}

/** Returns the index just *after* the bracket closing the opening bracket at `start`. Comment/string positions are skipped. */
const findBalancedEnd = (source: string, scan: SourceScan, start: number, open: string, close: string): number => {
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
const findTypeAliasEnd = (source: string, scan: SourceScan, start: number): number => {
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
const jsdocBefore = (source: string, scan: SourceScan, index: number): string | undefined => {
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

// ------------------------------------------------------------------
// Command extraction
// ------------------------------------------------------------------

/**
 * @experimental Extract exported function declarations from module source text: name, preceding jsdoc, and the full
 * parameter list (names, optionality, type annotation text, inline jsdoc). Supports `export function f(...)`,
 * `export async function f(...)`, `export const f = (...) => ...` (parenthesized arrows only), and
 * `export default function f(...)` (or an anonymous default function, which becomes a command named `default`).
 * Returns one command per export name: TS function overloads extract once per declaration, and the first overload
 * *signature* wins (see the dedupe note inline).
 */
export const extractModuleCommands = (source: string): ExtractedCommand[] => {
  const scan = scanSource(source)
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
  for (const {pattern, canBeSignature, default: defaultExport} of declarationPatterns) {
    for (const match of source.matchAll(pattern)) {
      if (scan.masked[match.index]) continue
      const name = match[1] || 'default'
      let parenIndex = match.index + match[0].length
      if (source[parenIndex] === '<') parenIndex = findBalancedEnd(source, scan, parenIndex, '<', '>') // skip generic type params
      while (parenIndex < source.length && /\s/.test(source[parenIndex])) parenIndex++
      if (source[parenIndex] !== '(') continue // not a function shape after all, e.g. `export function` matched inside something weird
      const parenEnd = findBalancedEnd(source, scan, parenIndex, '(', ')')
      declarations.push({
        name,
        exportName: defaultExport ? 'default' : name,
        default: defaultExport,
        position: match.index,
        hasBody: canBeSignature ? hasFunctionBody(source, scan, parenEnd) : true,
        paramList: source.slice(parenIndex + 1, parenEnd - 1),
        description: jsdocBefore(source, scan, match.index),
      })
    }
  }
  // matchAll over two patterns can't interleave, so restore source order - it determines command order in --help
  declarations.sort((a, b) => a.position - b.position)

  // One command per name, first extraction wins - with one twist for TS function overloads. Overloads extract once
  // per declaration: the body-less *signatures* come first and the *implementation* (whose params are typically
  // widened, e.g. `options: any`) last. TS resolves calls against the signatures in order, so the FIRST signature
  // is the primary documented shape - it becomes the command, and the implementation signature and later overloads
  // are ignored (a CLI can only present one calling convention; a union of all signatures was considered and
  // rejected, since it would advertise flag combinations no single overload accepts). The `hasBody` preference only
  // matters if an implementation somehow precedes a signature - in valid TS, first-wins already picks the first
  // signature. Params are parsed only for the winners, so an unannotated implementation (`function f(options) {`)
  // can't poison a command whose signatures are fine.
  const winners = new Map<string, (typeof declarations)[number]>()
  for (const declaration of declarations) {
    const existing = winners.get(declaration.name)
    if (!existing || (existing.hasBody && !declaration.hasBody)) winners.set(declaration.name, declaration)
  }
  return [...winners.values()].map(({name, exportName, default: defaultExport, description, paramList}) => ({
    name,
    exportName,
    default: defaultExport,
    description,
    params: parseParams(name, paramList),
  }))
}

/**
 * Determine whether a `function` declaration whose parameter list closes at `parenEnd` has a `{...}` body, or is a
 * body-less TS overload signature (`export function f(...): R` ending at a newline or semicolon). An optional
 * return-type annotation is scanned through with bracket-depth tracking; a depth-0 `{` is the body unless it sits
 * where an object type literal can start (after `:`, `|`, `&`, `?`, or the `>` of `=>`). Pragmatic rather than a
 * full type parser - an exotic depth-0 return type (e.g. a conditional type with a bare `extends {...}`) could
 * misclassify, which only matters when the same name is declared more than once.
 */
const hasFunctionBody = (source: string, scan: SourceScan, parenEnd: number): boolean => {
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
const parseParams = (functionName: string, paramList: string): ExtractedParam[] => {
  const scan = scanSource(paramList)

  // split at top-level commas into [start, end) segments, one per parameter
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

  return segments.flatMap((segment): ExtractedParam[] => {
    if (!paramList.slice(segment.start, segment.end).trim()) return [] // no parameters at all, or a trailing comma

    // find the top-level `:` (start of the type annotation) and `=` (start of a default value) within the segment
    let colon = -1
    let eq = -1
    depth = 0
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
      throw new Error(
        `Parameter "${nameText}" of "${functionName}" is a rest parameter, which isn't supported. Use an explicitly-typed array parameter (e.g. \`${nameText.slice(3)}: ${annotation}\`, which becomes a variadic positional argument), or move it into a trailing options object.`,
      )
    }
    const destructured = nameText.startsWith('{') || nameText.startsWith('[')
    const optionalMarker = nameText.endsWith('?')
    const name = destructured ? undefined : nameText.replace(/\?$/, '').trim()

    if (colon === -1) {
      throw new Error(
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
    const end = findTypeAliasEnd(source, scan, start)
    const text = `type ${match[1]} = ${source.slice(start, end).replace(/;\s*$/, '').trim()}`
    declarations.push({name: match[1], text})
  }
  for (const match of source.matchAll(
    /(?<![.\w$])(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)(\s+extends\s+[^{]+)?\s*\{/g,
  )) {
    if (scan.masked[match.index]) continue
    const braceIndex = match.index + match[0].length - 1
    const end = findBalancedEnd(source, scan, braceIndex, '{', '}')
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
