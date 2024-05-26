import {execa} from 'execa'
import * as path from 'path'
import stripAnsi from 'strip-ansi'
import {expect, test} from 'vitest'

const tsx = async (file: string, args: string[]) => {
  const {all} = await execa('./node_modules/.bin/tsx', ['test/fixtures/' + file, ...args], {
    all: true,
    reject: false,
    cwd: path.join(__dirname, '..'),
  })
  return stripAnsi(all)
}

test('cli help', async () => {
  const output = await tsx('calculator', ['--help'])
  expect(output.replaceAll(/(commands:|flags:)/gi, s => s[0].toUpperCase() + s.slice(1).toLowerCase()))
    .toMatchInlineSnapshot(`
      "Commands:
        add             Add two numbers. Use this if you and your friend both have apples, and you want to know how many apples there are in total.
        subtract        Subtract two numbers. Useful if you have a number and you want to make it smaller.
        multiply        Multiply two numbers together. Useful if you want to count the number of tiles on your bathroom wall and are short on time.
        divide          Divide two numbers. Useful if you have a number and you want to make it smaller and \`subtract\` isn't quite powerful enough for you.

      Flags:
        -h, --help                  Show help
            --verbose-errors        Throw raw errors (by default errors are summarised)
      "
    `)
})

test('cli help add', async () => {
  const output = await tsx('calculator', ['add', '--help'])
  expect(output).toMatchInlineSnapshot(`
    "add

    Add two numbers. Use this if you and your friend both have apples, and you want to know how many apples there are in total.

    Usage:
      add [flags...] <parameter 1> <parameter 2>

    Flags:
      -h, --help        Show help
    "
  `)
})

test('cli help divide', async () => {
  const output = await tsx('calculator', ['divide', '--help'])
  expect(output).toMatchInlineSnapshot(`
    "divide v1.0.0

    Divide two numbers. Useful if you have a number and you want to make it smaller and \`subtract\` isn't quite powerful enough for you.

    Usage:
      divide [flags...] <numerator> <denominator>

    Flags:
      -h, --help        Show help

    Examples:
      divide --left 8 --right 4
    "
  `)
})

test('cli add', async () => {
  const output = await tsx('calculator', ['add', '1', '2'])
  expect(output).toMatchInlineSnapshot(`"3"`)
})

test('cli add failure', async () => {
  const output = await tsx('calculator', ['add', '1', 'notanumber'])
  expect(output).toMatchInlineSnapshot(`
    "Validation error
      - Expected number, received string at index 1
    add

    Add two numbers. Use this if you and your friend both have apples, and you want to know how many apples there are in total.

    Usage:
      add [flags...] <parameter 1> <parameter 2>

    Flags:
      -h, --help        Show help
    "
  `)
})

test('cli divide', async () => {
  const output = await tsx('calculator', ['divide', '8', '4'])
  expect(output).toMatchInlineSnapshot(`"2"`)
})

test('cli divide failure', async () => {
  const output = await tsx('calculator', ['divide', '8', '0'])
  expect(output).toMatchInlineSnapshot(`
    "Validation error
      - Invalid input at index 1
    divide v1.0.0

    Divide two numbers. Useful if you have a number and you want to make it smaller and \`subtract\` isn't quite powerful enough for you.

    Usage:
      divide [flags...] <numerator> <denominator>

    Flags:
      -h, --help        Show help

    Examples:
      divide --left 8 --right 4
    "
  `)
})

test('migrations help', async () => {
  const output = await tsx('migrations', ['--help'])
  expect(output).toMatchInlineSnapshot(`
    "Commands:
      apply                   Apply migrations. By default all pending migrations will be applied.
      create                  Create a new migration
      list                    List all migrations
      search.byName           Look for migrations by name
      search.byContent        Look for migrations by their script content

    Flags:
      -h, --help                  Show help
          --verbose-errors        Throw raw errors (by default errors are summarised)
    "
  `)
})

test('migrations union type', async () => {
  let output = await tsx('migrations', ['apply', '--to', 'four'])

  expect(output).toMatchInlineSnapshot(`
    "one: executed
    two: executed
    three: executed
    four: executed
    five: pending"
  `)

  output = await tsx('migrations', ['apply', '--step', '1'])
  expect(output).toContain('four: pending') // <-- this sometimes goes wrong when I mess with union type handling
  expect(output).toMatchInlineSnapshot(`
    "one: executed
    two: executed
    three: executed
    four: pending
    five: pending"
  `)
})

test('migrations search.byName help', async () => {
  const output = await tsx('migrations', ['search.byName', '--help'])
  expect(output).toMatchInlineSnapshot(`
    "search.byName

    Look for migrations by name

    Usage:
      search.byName [flags...]

    Flags:
      -h, --help                   Show help
          --name <string>          
      -s, --status <string>        Filter to only show migrations with this status; Enum: executed,pending
    "
  `)
})

test('migrations search.byName', async () => {
  const output = await tsx('migrations', ['search.byName', '--name', 'two'])
  expect(output).toMatchInlineSnapshot(`
    "{
      "name": "two",
      "content": "create view two as select name from one",
      "status": "executed"
    }"
  `)
})

test('migrations search.byContent', async () => {
  const output = await tsx('migrations', ['search.byContent', '--searchTerm', 'create table'])
  expect(output).toMatchInlineSnapshot(`
    "{
      "name": "one",
      "content": "create table one(id int, name text)",
      "status": "executed"
    }
    {
      "name": "three",
      "content": "create table three(id int, foo int)",
      "status": "pending"
    }
    {
      "name": "five",
      "content": "create table five(id int)",
      "status": "pending"
    }"
  `)
})

test('migrations incompatible flags', async () => {
  const output = await tsx('migrations', ['apply', '--to', 'four', '--step', '1'])
  expect(output).toContain('--step and --to are incompatible')
  expect(output).toMatchInlineSnapshot(`
    "--step and --to are incompatible and cannot be used together
    apply

    Apply migrations. By default all pending migrations will be applied.

    Usage:
      apply [flags...]

    Flags:
      -h, --help                 Show help
          --step <number>        Mark this many migrations as executed; Exclusive minimum: 0
          --to <string>          Mark migrations up to this one as exectued
    "
  `)
})

test('fs help', async () => {
  const output = await tsx('fs', ['--help'])
  expect(output).toMatchInlineSnapshot(`
    "Commands:
      copy        
      diff        

    Flags:
      -h, --help                  Show help
          --verbose-errors        Throw raw errors (by default errors are summarised)
    "
  `)
})

test('fs copy help', async () => {
  const output = await tsx('fs', ['copy', '--help'])
  expect(output).toMatchInlineSnapshot(`
    "copy

    Usage:
      copy [flags...] <Source path> [Destination path]

    Flags:
          --force        Overwrite destination if it exists
      -h, --help         Show help
    "
  `)
})

test('fs copy', async () => {
  expect(await tsx('fs', ['copy', 'one'])).toMatchInlineSnapshot(
    `
      "{
        "source": "one",
        "destination": "one.copy",
        "options": {
          "force": false
        }
      }"
    `,
  )
  expect(await tsx('fs', ['copy', 'one', 'uno'])).toMatchInlineSnapshot(
    `
      "{
        "source": "one",
        "destination": "uno",
        "options": {
          "force": false
        }
      }"
    `,
  )
  expect(await tsx('fs', ['copy', 'one', '--force'])).toMatchInlineSnapshot(
    `
      "{
        "source": "one",
        "destination": "one.copy",
        "options": {
          "force": true
        }
      }"
    `,
  )
  expect(await tsx('fs', ['copy', 'one', 'uno', '--force'])).toMatchInlineSnapshot(
    `
      "{
        "source": "one",
        "destination": "uno",
        "options": {
          "force": true
        }
      }"
    `,
  )

  // invalid enum value:
  expect(await tsx('fs', ['diff', 'one', 'fileNotFound'])).toMatchInlineSnapshot(`
    "Validation error
      - Invalid enum value. Expected 'one' | 'two' | 'three' | 'four', received 'fileNotFound' at index 1
    diff

    Usage:
      diff [flags...] <Base path> <Head path>

    Flags:
      -h, --help                     Show help
          --ignore-whitespace        Ignore whitespace changes
          --trim                     Trim start/end whitespace
    "
  `)
})

test('fs diff', async () => {
  expect(await tsx('fs', ['diff', '--help'])).toMatchInlineSnapshot(`
    "diff

    Usage:
      diff [flags...] <Base path> <Head path>

    Flags:
      -h, --help                     Show help
          --ignore-whitespace        Ignore whitespace changes
          --trim                     Trim start/end whitespace
    "
  `)
  expect(await tsx('fs', ['diff', 'one', 'two'])).toMatchInlineSnapshot(`""`)
  expect(await tsx('fs', ['diff', 'one', 'three'])).toMatchInlineSnapshot(
    `"base and head differ at index 0 ("a" !== "x")"`,
  )
  expect(await tsx('fs', ['diff', 'three', 'four'])).toMatchInlineSnapshot(`"base has length 5 and head has length 6"`)
  expect(await tsx('fs', ['diff', 'three', 'four', '--ignore-whitespace'])).toMatchInlineSnapshot(`""`)
})
