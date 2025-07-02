/**
 * You can end up with "require is not defined" errors when we do disguised eval require calls like:
 * ```ts
 * const disguisedEval = eval
 * disguisedEval(`require('foo')`)
 * ```
 *
 * Seems vitest/vite try to helpfully handle all requires for us, but where we're doing that we just want to use the builtin require functionality.
 */
globalThis.require = require // you can end up with "require is not defined" errors when we do disguised `eval(`require('foo')`)` type calls

// some of the tests snapshot `--help` output, which does "smart" line wrapping based on the width of the terminal.
// this varies between CI and local machines, so set isTTY to false so commander does its (consistent) default wrapping behaviour.
// https://github.com/tj/commander.js/blob/e6f56c888c96d1339c2b974fee7e6ba4f2e3d218/lib/command.js#L66

// note: if this breaks some day, we could hook into the `Command` class and use `configureOutput` but easier to do globally for now.

for (const stream of [process.stdout, process.stderr]) {
  stream.columns = Infinity // ridiculous value to make sure I notice if the below line is removed
  stream.isTTY = false // set to false to simulate CI behaviour and avoid snapshot failures
}
