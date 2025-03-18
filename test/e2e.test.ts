import {execa} from 'execa'
import * as path from 'path'
import stripAnsi from 'strip-ansi'
import {expect, test} from 'vitest'
import '../src' // make sure vitest reruns this file after every change

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
      "Usage: calculator [options] [command]

      Options:
        -h, --help                            display help for command

      Commands:
        add <parameter_1> <parameter_2>       Add two numbers. Use this if you and
                                              your friend both have apples, and you
                                              want to know how many apples there are
                                              in total.
        subtract <parameter_1> <parameter_2>  Subtract two numbers. Useful if you have
                                              a number and you want to make it
                                              smaller.
        multiply <parameter_1> <parameter_2>  Multiply two numbers together. Useful if
                                              you want to count the number of tiles on
                                              your bathroom wall and are short on
                                              time.
        divide <numerator> <denominator>      Divide two numbers. Useful if you have a
                                              number and you want to make it smaller
                                              and \`subtract\` isn't quite powerful
                                              enough for you.
        squareRoot <number>                   Square root of a number. Useful if you
                                              have a square, know the area, and want
                                              to find the length of the side.
        help [command]                        display help for command"
    `)
})

test('cli help add', async () => {
  const output = await tsx('calculator', ['add', '--help'])
  expect(output).toMatchInlineSnapshot(`
    "Usage: calculator add [options] <parameter_1> <parameter_2>

    Add two numbers. Use this if you and your friend both have apples, and you want
    to know how many apples there are in total.

    Arguments:
      parameter_1   (required)
      parameter_2   (required)

    Options:
      -h, --help   display help for command"
  `)
})

test('cli help divide', async () => {
  const output = await tsx('calculator', ['divide', '--help'])
  expect(output).toMatchInlineSnapshot(`
    "Usage: calculator divide [options] <numerator> <denominator>

    Divide two numbers. Useful if you have a number and you want to make it smaller
    and \`subtract\` isn't quite powerful enough for you.

    Arguments:
      numerator    numerator (required)
      denominator  denominator (required)

    Options:
      -h, --help   display help for command

    Examples:
    divide --left 8 --right 4"
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

    Usage: calculator add [options] <parameter_1> <parameter_2>

    Add two numbers. Use this if you and your friend both have apples, and you want
    to know how many apples there are in total.

    Arguments:
      parameter_1   (required)
      parameter_2   (required)

    Options:
      -h, --help   display help for command
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

    Usage: calculator divide [options] <numerator> <denominator>

    Divide two numbers. Useful if you have a number and you want to make it smaller
    and \`subtract\` isn't quite powerful enough for you.

    Arguments:
      numerator    numerator (required)
      denominator  denominator (required)

    Options:
      -h, --help   display help for command
    "
  `)
})

test('cli non-existent command', async () => {
  const output = await tsx('calculator', ['multiploo', '2', '3'])
  expect(output).toMatchInlineSnapshot(`
    "error: unknown command 'multiploo'
    (Did you mean multiply?)



    Usage: calculator [options] [command]

    Options:
      -h, --help                            display help for command

    Commands:
      add <parameter_1> <parameter_2>       Add two numbers. Use this if you and
                                            your friend both have apples, and you
                                            want to know how many apples there are
                                            in total.
      subtract <parameter_1> <parameter_2>  Subtract two numbers. Useful if you have
                                            a number and you want to make it
                                            smaller.
      multiply <parameter_1> <parameter_2>  Multiply two numbers together. Useful if
                                            you want to count the number of tiles on
                                            your bathroom wall and are short on
                                            time.
      divide <numerator> <denominator>      Divide two numbers. Useful if you have a
                                            number and you want to make it smaller
                                            and \`subtract\` isn't quite powerful
                                            enough for you.
      squareRoot <number>                   Square root of a number. Useful if you
                                            have a square, know the area, and want
                                            to find the length of the side.
      help [command]                        display help for command
    "
  `)
})

test('cli no command', async () => {
  const output = await tsx('calculator', [])
  expect(output).toMatchInlineSnapshot(`
    "Usage: calculator [options] [command]

    Options:
      -h, --help                            display help for command

    Commands:
      add <parameter_1> <parameter_2>       Add two numbers. Use this if you and
                                            your friend both have apples, and you
                                            want to know how many apples there are
                                            in total.
      subtract <parameter_1> <parameter_2>  Subtract two numbers. Useful if you have
                                            a number and you want to make it
                                            smaller.
      multiply <parameter_1> <parameter_2>  Multiply two numbers together. Useful if
                                            you want to count the number of tiles on
                                            your bathroom wall and are short on
                                            time.
      divide <numerator> <denominator>      Divide two numbers. Useful if you have a
                                            number and you want to make it smaller
                                            and \`subtract\` isn't quite powerful
                                            enough for you.
      squareRoot <number>                   Square root of a number. Useful if you
                                            have a square, know the area, and want
                                            to find the length of the side.
      help [command]                        display help for command
    "
  `)
})

test('migrations help', async () => {
  const output = await tsx('migrations', ['--help'])
  expect(output).toMatchInlineSnapshot(`
    "Usage: migrations [options] [command]

    Options:
      -h, --help        display help for command

    Commands:
      up [options]      Apply migrations. By default all pending migrations will be
                        applied.
      create [options]  Create a new migration
      list [options]    List all migrations
      search            Available subcommands: byName, byContent
      help [command]    display help for command"
  `)
})

test('migrations union type', async () => {
  let output = await tsx('migrations', ['up', '--to', 'four'])

  expect(output).toMatchInlineSnapshot(`
    "one: executed
    two: executed
    three: executed
    four: executed
    five: pending"
  `)

  output = await tsx('migrations', ['up', '--step', '1'])
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
    "Usage: migrations [options] [command]

    Options:
      -h, --help        display help for command

    Commands:
      up [options]      Apply migrations. By default all pending migrations will be
                        applied.
      create [options]  Create a new migration
      list [options]    List all migrations
      search            Available subcommands: byName, byContent
      help [command]    display help for command"
  `)
})

test('migrations search.byName', async () => {
  const output = await tsx('migrations', ['search', 'byName', '--name', 'two'])
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
    "error: unknown command 'search.byContent'



    Usage: migrations [options] [command]

    Options:
      -h, --help        display help for command

    Commands:
      up [options]      Apply migrations. By default all pending migrations will be
                        applied.
      create [options]  Create a new migration
      list [options]    List all migrations
      search            Available subcommands: byName, byContent
      help [command]    display help for command
    "
  `)
})

test('migrations incompatible flags', async () => {
  const output = await tsx('migrations', ['up', '--to', 'four', '--step', '1'])
  expect(output).toMatchInlineSnapshot(`
    "error: option '--to [string]' cannot be used with option '--step [number]'



    Usage: migrations up [options]

    Apply migrations. By default all pending migrations will be applied.

    Options:
      --to [string]    Mark migrations up to this one as exectued
      --step [number]  Mark this many migrations as executed; Exclusive minimum: 0
      -h, --help       display help for command
    "
  `)
})

test('fs help', async () => {
  const output = await tsx('fs', ['--help'])
  expect(output).toMatchInlineSnapshot(`
    "Usage: fs [options] [command]

    Options:
      -h, --help                                       display help for command

    Commands:
      copy [options] <Source path> [Destination path]
      diff [options] <Base path> <Head path>
      help [command]                                   display help for command"
  `)
})

test('fs copy help', async () => {
  const output = await tsx('fs', ['copy', '--help'])
  expect(output).toMatchInlineSnapshot(`
    "Usage: fs copy [options] <Source path> [Destination path]

    Arguments:
      Source path        Source path (required)
      Destination path   Destination path

    Options:
      --force [boolean]  Overwrite destination if it exists (default: false)
      -h, --help         display help for command"
  `)
})

test('fs copy', async () => {
  expect(await tsx('fs', ['copy', 'one'])).toMatch(/Expected string at position 1, got undefined/)
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
    `"Expected string at position 1, got undefined"`,
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

    Usage: fs diff [options] <Base path> <Head path>

    Arguments:
      Base path                     Base path (required)
      Head path                     Head path (required)

    Options:
      --ignoreWhitespace [boolean]  Ignore whitespace changes (default: false)
      --trim [boolean]              Trim start/end whitespace (default: false)
      -h, --help                    display help for command
    "
  `)
})

test('fs diff', async () => {
  expect(await tsx('fs', ['diff', '--help'])).toMatchInlineSnapshot(`
    "Usage: fs diff [options] <Base path> <Head path>

    Arguments:
      Base path                     Base path (required)
      Head path                     Head path (required)

    Options:
      --ignoreWhitespace [boolean]  Ignore whitespace changes (default: false)
      --trim [boolean]              Trim start/end whitespace (default: false)
      -h, --help                    display help for command"
  `)
  expect(await tsx('fs', ['diff', 'one', 'two'])).toMatchInlineSnapshot(`""`)
  expect(await tsx('fs', ['diff', 'one', 'three'])).toMatchInlineSnapshot(
    `"base and head differ at index 0 ("a" !== "x")"`,
  )
  expect(await tsx('fs', ['diff', 'three', 'four'])).toMatchInlineSnapshot(`"base has length 5 and head has length 6"`)
  expect(await tsx('fs', ['diff', 'three', 'four', '--ignoreWhitespace'])).toMatchInlineSnapshot(`""`)
})

test('thrown error in procedure includes call stack', async () => {
  const output = await tsx('calculator', ['squareRoot', '--', '-1'])
  expect(output).toMatch(/Error: Get real/)
  expect(output).toMatch(/at .* \(.*calculator.ts:\d+:\d+\)/)
})
