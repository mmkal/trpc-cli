import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {expect, test} from 'vitest'
import {guessCliName, scriptBasename} from '../src/resolve-name.js'

test('falls back to the entry script basename, minus extension', () => {
  expect(guessCliName({}, ['node', '/repo/src/my-tool.ts'])).toBe('my-tool')
  expect(guessCliName({}, ['node', 'relative/my-tool.js'])).toBe('my-tool')
})

test('returns undefined with no entry script (REPL, node -e)', () => {
  expect(guessCliName({}, ['node'])).toBeUndefined()
})

test('uses npm_lifecycle_event when the lifecycle script mentions the entry script', () => {
  const env = {npm_lifecycle_event: 'dev', npm_lifecycle_script: 'tsx src/cli.ts'}
  expect(guessCliName(env, ['node', '/repo/src/cli.ts'])).toBe('dev')
})

test('ignores npm_lifecycle_event inherited from an unrelated npm script', () => {
  // `npm run build` sets npm_lifecycle_event=build for every (grand)child process - a CLI merely spawned
  // under the build should not be named "build"
  const env = {npm_lifecycle_event: 'build', npm_lifecycle_script: 'tsc -p tsconfig.json'}
  expect(guessCliName(env, ['node', '/repo/dist/my-tool.js'])).toBe('my-tool')
})

test('ignores npx/dlx runner artifacts', () => {
  const env = {npm_lifecycle_event: 'npx', npm_lifecycle_script: 'my-tool.js'}
  expect(guessCliName(env, ['node', '/repo/my-tool.js'])).toBe('my-tool')
})

test('uses the bin name from package.json when the entry script is a bin target', () => {
  using pkg = fakePackage({name: 'some-package', bin: {'my-great-cli': './dist/cli.js'}})
  expect(guessCliName({}, ['node', path.join(pkg.dir, 'dist/cli.js')])).toBe('my-great-cli')
})

test('string-form bin uses the package name, scope stripped', () => {
  using pkg = fakePackage({name: '@myscope/my-great-cli', bin: './dist/cli.js'})
  expect(guessCliName({}, ['node', path.join(pkg.dir, 'dist/cli.js')])).toBe('my-great-cli')
})

test('bin match wins over npm_lifecycle_event', () => {
  using pkg = fakePackage({name: 'some-package', bin: {'my-great-cli': './dist/cli.js'}})
  const env = {npm_lifecycle_event: 'dev', npm_lifecycle_script: 'node dist/cli.js'}
  expect(guessCliName(env, ['node', path.join(pkg.dir, 'dist/cli.js')])).toBe('my-great-cli')
})

test('non-bin scripts in a package with bins fall back to the basename', () => {
  using pkg = fakePackage({name: 'some-package', bin: {'my-great-cli': './dist/cli.js'}})
  expect(guessCliName({}, ['node', path.join(pkg.dir, 'dist/other.js')])).toBe('other')
})

test('bin symlinks (node_modules/.bin style) resolve to the bin name via realpath', () => {
  using pkg = fakePackage({name: 'some-package', bin: {'my-great-cli': './dist/cli.js'}})
  const dotBin = path.join(pkg.dir, 'node_modules/.bin')
  fs.mkdirSync(dotBin, {recursive: true})
  const symlink = path.join(dotBin, 'my-great-cli')
  fs.symlinkSync(path.join(pkg.dir, 'dist/cli.js'), symlink)
  expect(guessCliName({}, ['node', symlink])).toBe('my-great-cli')
})

test('scriptBasename handles paths, file URLs and URL objects', () => {
  expect(scriptBasename('/repo/src/commands.ts')).toBe('commands')
  expect(scriptBasename('file:///repo/src/commands.ts')).toBe('commands')
  expect(scriptBasename(new URL('file:///repo/src/commands.ts'))).toBe('commands')
  expect(scriptBasename('commands.ts')).toBe('commands')
})

/** creates a real (temp) package dir with a package.json and a dist/cli.js + dist/other.js, disposed after the test */
function fakePackage(packageJson: {name: string; bin: string | Record<string, string>}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trpc-cli-resolve-name-'))
  fs.mkdirSync(path.join(dir, 'dist'), {recursive: true})
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(packageJson, null, 2))
  fs.writeFileSync(path.join(dir, 'dist/cli.js'), '#!/usr/bin/env node\n')
  fs.writeFileSync(path.join(dir, 'dist/other.js'), '')
  return {
    dir,
    [Symbol.dispose]() {
      fs.rmSync(dir, {recursive: true, force: true})
    },
  }
}
