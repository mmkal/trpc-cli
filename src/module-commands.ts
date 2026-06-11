/**
 * @experimental Derive a CLI from a plain TypeScript module of exported functions - no schema library, no router.
 *
 * Runtime functions carry no type information, so this works from two inputs: the module's *source text* (to extract
 * each exported function's first-parameter type and jsdoc) and its *live exports* (to actually call the functions).
 * The extracted parameter type text is handed to the vendored `Type.Script` (see ./typebox), which turns it into a
 * JSON Schema - including jsdoc comments as property descriptions - with a `~standard` validator attached. Each
 * function becomes a norpc procedure, so the rest of trpc-cli treats the module like any other router.
 *
 * The source "parser" here is deliberately a lightweight hand-rolled extractor, not the TypeScript compiler API:
 * it only needs to find exported function declarations, the jsdoc immediately preceding them, and the balanced
 * `{...}` (or named-reference) text of the first parameter's type annotation. The heavy lifting - turning type
 * syntax into JSON Schema - is all `Type.Script`.
 */
import {t} from './norpc.js'
import {NorpcProcedureLike, NorpcRouterLike} from './parse-router.js'
import Type from './typebox/index.js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any

/**
 * @experimental
 * The `module` option for `createCli`: either a path to a TypeScript/JavaScript module (resolved against
 * `process.cwd()`, read with `node:fs` and dynamically imported - run under tsx/bun/deno/node>=22.18 for `.ts` files),
 * or an explicit `{source, exports}` pair for environments where file reading/dynamic import isn't possible
 * (bundlers, browsers): `{source: rawSourceText, exports: await import('./commands.js')}`.
 */
export type CliModuleInput = string | {source: string; exports: Record<string, unknown>}

/** A command extracted from module source text. */
export interface ExtractedCommand {
  /** the export name, e.g. `installPackages` - becomes the (kebab-cased) command name */
  name: string
  /** cleaned jsdoc text from the comment immediately preceding the export - becomes the command description */
  description: string | undefined
  /** raw text of the first parameter's type annotation, e.g. `{foo: string}` or `Options`. Undefined = no parameters */
  paramType: string | undefined
}

/**
 * @experimental Resolve a `CliModuleInput` to a norpc router. The string form reads the file and dynamically
 * imports it - `node:` modules are imported lazily here so this file stays safe to bundle for non-node targets.
 */
export const moduleToRouter = async (moduleInput: CliModuleInput): Promise<NorpcRouterLike> => {
  const resolved = typeof moduleInput === 'string' ? await loadModuleFromPath(moduleInput) : moduleInput
  return buildRouterFromModule(resolved)
}

const loadModuleFromPath = async (filepath: string) => {
  const [fs, path, url] = await Promise.all([
    import('node:fs/promises'),
    // eslint-disable-next-line unicorn/import-style -- dynamic import: there's no "default import" syntax to use here
    import('node:path').then(m => m.default),
    import('node:url'),
  ])
  const fullpath = path.resolve(process.cwd(), filepath)
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
 * procedures: source order determines command order, function jsdoc becomes the command description, and the first
 * parameter's type annotation (inline `{...}` literal, or a reference to a `type`/`interface` declared in the same
 * file) is parsed by the vendored `Type.Script` into the input schema.
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
    const fn = exports[command.name]
    if (typeof fn !== 'function') continue // e.g. `export const x = (2 + 3)` - extractor can match non-functions; runtime is the source of truth
    procedures[command.name] = buildProcedure(command, fn as AnyFn, context)
  }

  const unmatched = Object.entries(exports)
    .filter(([name, value]) => typeof value === 'function' && name !== 'default' && !(name in procedures))
    .map(([name]) => name)
  if (unmatched.length > 0) {
    throw new Error(
      `Could not find a parseable declaration for exported function(s) ${unmatched.map(n => JSON.stringify(n)).join(', ')}. ` +
        `Supported syntaxes (declared directly in the module source): \`export function name(...)\`, \`export async function name(...)\`, \`export const name = (...) => ...\`. ` +
        `Re-exports, \`export {name}\` statements and default exports aren't supported.`,
    )
  }
  if (Object.keys(procedures).length === 0) {
    throw new Error(
      `No commands found in module. Export functions with \`export function name(...)\`, \`export async function name(...)\` or \`export const name = (...) => ...\`.`,
    )
  }
  return t.router(procedures)
}

const buildProcedure = (command: ExtractedCommand, fn: AnyFn, context: Record<string, unknown>): NorpcProcedureLike => {
  const builder = command.description ? t.procedure.meta({description: command.description}) : t.procedure
  if (command.paramType === undefined) {
    return builder.handler(() => fn())
  }
  const schema = Type.Script(context as never, command.paramType)
  if (isNeverSchema(schema)) {
    throw new Error(
      `Could not parse the parameter type for "${command.name}": \`${command.paramType}\`. ` +
        `Use an inline object type literal like \`{foo: string}\`, or a reference to a \`type X = {...}\`/\`interface X {...}\` declared in the same file.`,
    )
  }
  const danglingRefs = collectRefs(schema)
  if (danglingRefs.length > 0) {
    throw new Error(
      `The parameter type for "${command.name}" references ${danglingRefs.map(r => JSON.stringify(r)).join(', ')}, which couldn't be resolved. ` +
        `Declare it as \`type X = {...}\` or \`interface X {...}\` in the same file, or inline the object type literal.`,
    )
  }
  if ((schema as {type?: string}).type !== 'object') {
    throw new Error(
      `The first parameter of "${command.name}" must be an object type, got \`${command.paramType}\`. ` +
        `Non-object parameters aren't supported yet - wrap the value in an object, e.g. \`{value: ${command.paramType}}\`.`,
    )
  }
  return builder.input(schema as never).handler(({input}) => fn(input))
}

// ------------------------------------------------------------------
// Source scanning - shared comment/string awareness
// ------------------------------------------------------------------

interface SourceScan {
  /** for each index of the source: true if inside a comment or string/template literal */
  masked: boolean[]
  /** block comments in order of appearance, with their raw text */
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
    if (source[i] === open) depth++
    else if (source[i] === close) {
      depth--
      if (depth === 0) return i + 1
    }
  }
  throw new Error(`Unbalanced \`${open}${close}\` starting at index ${start} of module source`)
}

/** Finds the cleaned text of a jsdoc block comment separated from `index` only by whitespace, if any. */
const jsdocBefore = (source: string, scan: SourceScan, index: number): string | undefined => {
  let i = index - 1
  while (i >= 0 && /\s/.test(source[i])) i--
  const comment = scan.comments.find(c => c.end === i + 1)
  if (!comment?.text.startsWith('/**')) return undefined
  const cleaned = comment.text
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
 * @experimental Extract exported function declarations from module source text: name, preceding jsdoc, and the raw
 * text of the first parameter's type annotation. Supports `export function f(...)`, `export async function f(...)`
 * and `export const f = (...) => ...` (parenthesized arrows only).
 */
export const extractModuleCommands = (source: string): ExtractedCommand[] => {
  const scan = scanSource(source)
  const commands: Array<ExtractedCommand & {position: number}> = []

  const declarationPatterns = [
    /(?<![.\w$])export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*/g,
    /(?<![.\w$])export\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?=\()/g,
  ]
  for (const pattern of declarationPatterns) {
    for (const match of source.matchAll(pattern)) {
      if (scan.masked[match.index]) continue
      const name = match[1]
      let parenIndex = match.index + match[0].length
      if (source[parenIndex] === '<') parenIndex = findBalancedEnd(source, scan, parenIndex, '<', '>') // skip generic type params
      while (parenIndex < source.length && /\s/.test(source[parenIndex])) parenIndex++
      if (source[parenIndex] !== '(') continue // not a function shape after all, e.g. `export function` matched inside something weird
      const parenEnd = findBalancedEnd(source, scan, parenIndex, '(', ')')
      const paramList = source.slice(parenIndex + 1, parenEnd - 1)
      commands.push({
        name,
        description: jsdocBefore(source, scan, match.index),
        paramType: parseFirstParamType(name, paramList),
        position: match.index,
      })
    }
  }
  // matchAll over two patterns can't interleave, so restore source order - it determines command order in --help
  return commands.sort((a, b) => a.position - b.position).map(({position: _, ...command}) => command)
}

/**
 * Given the text between a function's parens, slice out the first parameter's type annotation. Handles destructuring
 * patterns, optional markers (`options?: ...`) and default values (`options: X = {}`). `<`/`>` are tracked as
 * brackets (so `Map<string, number>` survives the top-level-comma check) except the `>` of `=>`.
 */
const parseFirstParamType = (functionName: string, paramList: string): string | undefined => {
  const scan = scanSource(paramList)
  let depth = 0
  let colon = -1
  const sliceAnnotation = (end: number): string | undefined => {
    const firstParamText = paramList.slice(0, end).trim()
    if (!firstParamText) return undefined // no parameters at all
    if (colon === -1) {
      throw new Error(
        `The first parameter of "${functionName}" has no type annotation. Annotate it with an object type, e.g. \`(${firstParamText}: {someFlag: string})\`.`,
      )
    }
    const annotation = paramList
      .slice(colon + 1, end)
      .replace(/\?\s*$/, '') // `options?: {...}` puts the `?` before the colon, but just in case
      .trim()
    return annotation
  }
  for (let i = 0; i < paramList.length; i++) {
    if (scan.masked[i]) continue
    const ch = paramList[i]
    if (ch === '(' || ch === '{' || ch === '[' || ch === '<') depth++
    else if (ch === ')' || ch === '}' || ch === ']') depth--
    else if (ch === '>' && paramList[i - 1] !== '=') depth--
    else if (depth === 0 && colon === -1 && ch === ':') colon = i
    else if (depth === 0 && (ch === ',' || (ch === '=' && paramList[i + 1] !== '>'))) {
      return sliceAnnotation(i) // first param ends: either the next param or a default value
    }
  }
  return sliceAnnotation(paramList.length)
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
    let end: number
    if (source[start] === '{') {
      end = findBalancedEnd(source, scan, start, '{', '}')
    } else {
      // simple single-line alias like `type Mode = 'a' | 'b'` - slice to end of line, dropping any trailing semicolon
      const newline = source.indexOf('\n', start)
      end = newline === -1 ? source.length : newline
    }
    const text = `type ${match[1]} = ${source.slice(start, end).replace(/;\s*$/, '')}`
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
