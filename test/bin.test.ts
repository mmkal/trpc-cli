import {execa} from 'execa'
import * as path from 'path'
import stripAnsi from 'strip-ansi'
import {expect, test} from 'vitest'
import '../src' // make sure vitest reruns this file after every change (note: not src/bin.ts - importing that would execute it)

test('--help lists commands derived from plain exported functions', async () => {
  const output = await bin('commands-module.ts', ['--help'])
  expect(output).toContain('install')
  expect(output).toContain('install dependencies from the lockfile')
  expect(output).toContain('add')
  expect(output).toContain('add a package to the dependencies')
  expect(output).toContain('list-versions')
})

test('the CLI is named after the module file', async () => {
  const output = await bin('commands-module.ts', ['--help'])
  expect(output).toContain('Usage: commands-module')
})

test('runs a command, logging the result with the yaml table logger', async () => {
  const output = await bin('commands-module.ts', ['add', '--package-name', 'left-pad'])
  expect(output).toMatchInlineSnapshot(`
    "added: left-pad
    dev: false"
  `)
})

test('jsonInput auto enables --json', async () => {
  const output = await bin('commands-module.ts', ['add', '--json', '{"packageName": "is-odd", "dev": true}'])
  expect(output).toMatchInlineSnapshot(`
    "added: is-odd
    dev: true"
  `)
})

test('multi-parameter functions become positional arguments', async () => {
  const output = await bin('positional-commands-module.ts', ['add', '2', '3'])
  expect(output).toBe('5')
})

test('validation failures name the offending flag', async () => {
  const output = await bin('commands-module.ts', ['add'])
  expect(output).toContain(`required option '--package-name <string>' not specified`)
})

test('no module argument prints usage and exits nonzero', async () => {
  const {all, exitCode} = await binRaw([])
  expect(exitCode).toBe(1)
  expect(all).toContain('Usage: trpc-cli <module>')
})

test('--help with no module prints usage and exits zero', async () => {
  const {all, exitCode} = await binRaw(['--help'])
  expect(exitCode).toBe(0)
  expect(all).toContain('Usage: trpc-cli <module>')
})

/** runs `src/bin.ts` under tsx against a fixture file, like `npx trpc-cli <fixture>` would for an end user */
const bin = async (fixture: string, args: string[]) => {
  const {all} = await binRaw([`test/fixtures/${fixture}`, ...args])
  return stripAnsi(all).trim()
}

const binRaw = (args: string[]) => {
  return execa('./node_modules/.bin/tsx', ['src/bin.ts', ...args], {
    all: true,
    reject: false,
    cwd: path.join(__dirname, '..'),
    // by default missing inputs are only prompted for when stdin is a TTY and no coding agent is detected - stdin
    // is a pipe here so prompts are already off, but force agent mode too so the suite fails fast rather than
    // hanging if that heuristic ever changes
    env: {CLAUDECODE: '1'},
  })
}
