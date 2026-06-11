/**
 * Fixture for the experimental `createCli({module: ...})` feature: a plain TypeScript module of exported functions.
 * No trpc-cli imports, no schema library - the CLI is derived from this file's source text + live exports.
 * Note: this file is imported *natively* (not via vite/vitest transforms) in the path-based tests, so it must stick
 * to erasable-only TypeScript syntax (no enums, no parameter properties).
 */

/** install dependencies from the lockfile */
export async function install(options: {
  /** fail if the lockfile is out of date */
  frozenLockfile?: boolean
}) {
  return options.frozenLockfile ? 'installed dependencies (frozen lockfile)' : 'installed dependencies'
}

type AddOptions = {
  /** the name of the package to add */
  packageName: string
  /** add to devDependencies instead of dependencies */
  dev?: boolean
}

/** add a package to the dependencies */
export const add = async (options: AddOptions) => {
  return {added: options.packageName, dev: options.dev || false}
}

/** print versions of all installed packages */
export function listVersions() {
  return {'left-pad': '1.3.0', 'is-odd': '3.0.1'}
}

// not a function - should be ignored, not turned into a command
export const REGISTRY_URL = 'https://registry.npmjs.org'
