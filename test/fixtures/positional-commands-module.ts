/**
 * Fixture for positional arguments via `createCli({module: ...})`: multi-parameter exported functions. Leading
 * scalar parameters become positional arguments; a trailing object parameter becomes flags. Like
 * commands-module.ts, this file is imported *natively* in the path-based tests, so it must stick to erasable-only
 * TypeScript syntax (no enums, no parameter properties).
 */

/** add two numbers */
export async function add(left: number, right: number) {
  return left + right
}

type CopyOptions = {
  /** overwrite the destination if it exists */
  force?: boolean
}

/** copy a file */
export async function copy(
  /** the file to copy */ source: string,
  /** where to copy it (defaults to `<source>.bak`) */ dest?: string,
  options?: CopyOptions,
) {
  const target = dest || source + '.bak'
  return `copied ${source} to ${target}${options?.force ? ' (forced)' : ''}`
}

/** repeat a word */
export function repeat(word: string, times: number = 2) {
  return Array.from({length: times}, () => word).join(' ')
}

/** double a number */
export const double = (theNumber: number) => theNumber * 2

/** join words with a separator */
export function joinWords(words: string[], options: {separator?: string}) {
  return words.join(options.separator || ' ')
}
