/**
 * Fixture for the headline `createCli(import.meta).run()` pattern: a single self-contained file that defines its
 * commands AND turns itself into a CLI. `import.meta` carries this file's location, so trpc-cli re-imports it to
 * get the live exports (a self-import - safe because the call is at the BOTTOM and isn't top-level-awaited).
 * Erasable-only TypeScript, so it can be imported natively (no enums / parameter properties).
 */
import {createCli} from '../../src/index.js'

/** add two numbers */
export function add(left: number, right: number) {
  return left + right
}

/** greet someone */
export const greet = (options: {
  /** who to greet */
  name: string
}) => {
  return `hello ${options.name}`
}

void createCli(import.meta).run()
