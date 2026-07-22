/**
 * Derivation of a default CLI name when `createCli` isn't given an explicit `name`.
 * See the readme section "How the CLI name is resolved" for the full precedence order.
 */

// node:fs / node:path are only needed for the installed-bin lookup - load them softly (like the optional
// @orpc/server import in index.ts) so non-node runtimes and bundlers degrade to skipping that rule
// eslint-disable-next-line unicorn/import-style -- dynamic import: there's no "default import" syntax to use here
const nodeBuiltinsOrError = await Promise.all([import('node:fs'), import('node:path')]).catch(String)

export type NameEnvironment = Record<string, string | undefined>

/**
 * Guess the CLI name from the process environment. First hit wins:
 *
 * 1. a `bin` entry in the entry script's package.json pointing (realpath-compared) at the entry script
 * 2. `npm_lifecycle_event` - but only when `npm_lifecycle_script` mentions the entry script, so the name of an
 *    unrelated npm script (which every child process inherits via env) can't leak into a CLI merely spawned under it
 * 3. the entry script's basename, minus extension - matching what commander would do by itself
 *
 * Returns undefined when there's no entry script to go on (REPL, browser, `node -e`).
 */
export function guessCliName(env: NameEnvironment = process.env, argv: string[] = process.argv): string | undefined {
  const script = argv[1]
  if (!script) return undefined
  return binEntryName(script) || lifecycleScriptName(env, script) || scriptBasename(script)
}

/** basename minus extension of a path, path-ish string or URL, e.g. `/repo/src/cli.ts` -> `cli` */
export const scriptBasename = (script: string | URL): string | undefined => {
  const pathname = typeof script === 'string' ? script : script.pathname
  const base = pathname.split(/[\\/]/).pop()
  return base?.replace(/\.[^.]+$/, '') || undefined
}

const lifecycleScriptName = (env: NameEnvironment, script: string) => {
  const event = env.npm_lifecycle_event
  if (!event || event === 'npx' || event === 'dlx') return undefined // runner artifacts, not names anyone chose
  const base = script.split(/[\\/]/).pop()
  if (!base || !env.npm_lifecycle_script?.includes(base)) return undefined
  return event
}

const binEntryName = (script: string): string | undefined => {
  if (typeof nodeBuiltinsOrError === 'string') return undefined
  const [fs, path] = nodeBuiltinsOrError
  const realpath = (target: string) => {
    try {
      return fs.realpathSync(target)
    } catch {
      return undefined
    }
  }
  const real = realpath(script)
  if (!real) return undefined
  // walk up from the script looking for its owning package.json. Stop at the first one found - a `bin` defined
  // further up would belong to a different package.
  for (let dir = path.dirname(real); ; dir = path.dirname(dir)) {
    const packageJson = readPackageJson(fs, path.join(dir, 'package.json'))
    if (packageJson) {
      const binEntries =
        typeof packageJson.bin === 'string'
          ? {[String(packageJson.name).split('/').pop() || '']: packageJson.bin}
          : packageJson.bin || {}
      for (const [binName, target] of Object.entries(binEntries)) {
        if (binName && typeof target === 'string' && realpath(path.resolve(dir, target)) === real) return binName
      }
      return undefined
    }
    if (path.dirname(dir) === dir) return undefined
  }
}

const readPackageJson = (fs: typeof import('node:fs'), filepath: string) => {
  try {
    if (!fs.existsSync(filepath)) return undefined
    return JSON.parse(fs.readFileSync(filepath, 'utf8')) as {name?: string; bin?: string | Record<string, string>}
  } catch {
    return undefined
  }
}
