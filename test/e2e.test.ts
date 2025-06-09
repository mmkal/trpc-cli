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

const tsxWithInput = async (input: string, file: string, args: string[]) => {
  const checkValue = (name: string, value: string) => {
    // make sure it's a simple value, no spaces or weird escapable characters
    if (!/^[\w./-]*$/.test(value)) {
      throw new Error(`Invalid input for ${name}: ${value}`)
    }
  }
  checkValue('input', input)
  checkValue('file', file)
  args.forEach((a, i) => checkValue(`arg ${i}`, a))

  const {all} = await execa(
    'sh',
    ['-c', `echo ${input} | ./node_modules/.bin/tsx test/fixtures/${file} ${args.join(' ')}`],
    {
      all: true,
      reject: false,
      cwd: path.join(__dirname, '..'),
    },
  )
  return stripAnsi(all)
}

const tsxWithMultilineInput = async (input: string, file: string, args: string[]) => {
  if (process.env.CI) console.warn(`So far this hasn't worked in CI, you'll probably get timeouts'`)
  const runSubprocess = () =>
    execa('./node_modules/.bin/tsx', [`test/fixtures/${file}`, ...args], {
      all: true,
      reject: false,
    })
  let subprocess: ReturnType<typeof runSubprocess> | null = null
  const [{all: output}] = await Promise.all([
    (subprocess = runSubprocess()),
    Promise.resolve().then(async () => {
      for (const line of input.split('\n')) {
        await new Promise(resolve => setTimeout(resolve, 150))
        subprocess!.stdin.write(line + '\n')
      }
      return null
    }),
  ])

  return stripAnsi(output.replaceAll(/(\[36m)(\w)/g, '$1\n $2')) // [36m is magic ansi thing that appears before user input for whatever reason
}

test('cli help', async () => {
  const output = await tsx('calculator', ['--help'])
  expect(output.replaceAll(/(commands:|flags:)/gi, s => s[0].toUpperCase() + s.slice(1).toLowerCase()))
    .toMatchInlineSnapshot(`
      "Usage: calculator [options] [command]

      Available subCommands: add, subtract, multiply, divide, square-root

      Options:
        -V, --version                         output the version number
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
        square-root <number>                  Square root of a number. Useful if you
                                              have a square, know the area, and want
                                              to find the length of the side.
        help [command]                        display help for command
      "
    `)
})

test('cli help add', async () => {
  const output = await tsx('calculator', ['add', '--help'])
  expect(output).toMatchInlineSnapshot(`
    "Usage: calculator add [options] <parameter_1> <parameter_2>

    Add two numbers. Use this if you and your friend both have apples, and you want
    to know how many apples there are in total.

    Arguments:
      parameter_1  number (required)
      parameter_2  number (required)

    Options:
      -h, --help   display help for command
    "
  `)
})

test('cli help divide', async () => {
  const output = await tsx('calculator', ['divide', '--help'])
  expect(output).toMatchInlineSnapshot(`
    "Usage: calculator divide [options] <numerator> <denominator>

    Divide two numbers. Useful if you have a number and you want to make it smaller
    and \`subtract\` isn't quite powerful enough for you.

    Arguments:
      numerator    number numerator (required)
      denominator  number denominator (required)

    Options:
      -h, --help   display help for command


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
    "error: command-argument value 'notanumber' is invalid for argument 'parameter_2'. Invalid number: notanumber



    Usage: calculator add [options] <parameter_1> <parameter_2>

    Add two numbers. Use this if you and your friend both have apples, and you want
    to know how many apples there are in total.

    Arguments:
      parameter_1  number (required)
      parameter_2  number (required)

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
    "✖ Invalid input → at [1]

    Usage: calculator divide [options] <numerator> <denominator>

    Divide two numbers. Useful if you have a number and you want to make it smaller
    and \`subtract\` isn't quite powerful enough for you.

    Arguments:
      numerator    number numerator (required)
      denominator  number denominator (required)

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

    Available subcommands: add, subtract, multiply, divide, square-root

    Options:
      -V, --version                         output the version number
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
      square-root <number>                  Square root of a number. Useful if you
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

    Available subcommands: add, subtract, multiply, divide, square-root

    Options:
      -V, --version                         output the version number
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
      square-root <number>                  Square root of a number. Useful if you
                                            have a square, know the area, and want
                                            to find the length of the side.
      help [command]                        display help for command
    "
  `)
})

test('migrations help', async () => {
  const version = await tsx('migrations', ['--version'])
  expect(version.trim()).toMatchInlineSnapshot(`"1.0.0"`)

  const output = await tsx('migrations', ['--help'])
  expect(output).toMatchInlineSnapshot(`
    "Usage: migrations migrations down

    Manage migrations
    Available subcommands: up, create, list, search

    Options:
      -V, --version     output the version number
      -h, --help        display help for command

    Commands:
      up [options]      Apply migrations. By default all pending migrations will be
                        applied.
      create [options]  Create a new migration
      list [options]    List all migrations
      search            Available subcommands: by-name, by-content
      help [command]    display help for command
    "
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
    "Usage: migrations migrations down

    Manage migrations
    Available subcommands: up, create, list, search

    Options:
      -V, --version     output the version number
      -h, --help        display help for command

    Commands:
      up [options]      Apply migrations. By default all pending migrations will be
                        applied.
      create [options]  Create a new migration
      list [options]    List all migrations
      search            Available subcommands: by-name, by-content
      help [command]    display help for command
    "
  `)
})

test('migrations search.byName', async () => {
  const output = await tsx('migrations', ['search', 'by-name', '--name', 'two'])
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



    Usage: migrations migrations down

    Manage migrations
    Available subcommands: up, create, list, search

    Options:
      -V, --version     output the version number
      -h, --help        display help for command

    Commands:
      up [options]      Apply migrations. By default all pending migrations will be
                        applied.
      create [options]  Create a new migration
      list [options]    List all migrations
      search            Available subcommands: by-name, by-content
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

    Available subcommands: copy, diff

    Options:
      -h, --help                                       display help for command

    Commands:
      copy [options] <Source path> [Destination path]
      diff [options] <Base path> <Head path>
      help [command]                                   display help for command
    "
  `)
})

test('fs copy help', async () => {
  const output = await tsx('fs', ['copy', '--help'])
  expect(output).toMatchInlineSnapshot(`
    "Usage: fs copy [options] <Source path> [Destination path]

    Arguments:
      Source path        Source path (required)
      Destination path   string | null Destination path

    Options:
      --force [boolean]  Overwrite destination if it exists (default: false)
      -h, --help         display help for command
    "
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
    "✖ Invalid option: expected one of "one"|"two"|"three"|"four" → at [1]

    Usage: fs diff [options] <Base path> <Head path>

    Arguments:
      Base path                      Base path (required)
      Head path                      Head path (required)

    Options:
      --ignore-whitespace [boolean]  Ignore whitespace changes (default: false)
      --trim [boolean]               Trim start/end whitespace (default: false)
      -h, --help                     display help for command
    "
  `)
})

test('fs diff', async () => {
  expect(await tsx('fs', ['diff', '--help'])).toMatchInlineSnapshot(`
    "Usage: fs diff [options] <Base path> <Head path>

    Arguments:
      Base path                      Base path (required)
      Head path                      Head path (required)

    Options:
      --ignore-whitespace [boolean]  Ignore whitespace changes (default: false)
      --trim [boolean]               Trim start/end whitespace (default: false)
      -h, --help                     display help for command
    "
  `)
  expect(await tsx('fs', ['diff', 'one', 'two'])).toMatchInlineSnapshot(`""`)
  expect(await tsx('fs', ['diff', 'one', 'three'])).toMatchInlineSnapshot(
    `"base and head differ at index 0 ("a" !== "x")"`,
  )
  expect(await tsx('fs', ['diff', 'three', 'four'])).toMatchInlineSnapshot(`"base has length 5 and head has length 6"`)
  expect(await tsx('fs', ['diff', 'three', 'four', '--ignore-whitespace'])).toMatchInlineSnapshot(`""`)
})

test('thrown error in procedure includes call stack', async () => {
  const output = await tsx('calculator', ['square-root', '--', '-1'])
  expect(output).toMatch(/Error: Get real/)
  expect(output).toMatch(/at .* \(.*calculator.ts:\d+:\d+\)/)
})

const testLocalOnly = process.env.CI ? test.skip : test

test('promptable', async () => {
  // these snapshots look a little weird because inquirer uses `\r` to
  // replace the input line
  const yOutput = await tsxWithInput('X', 'promptable', ['challenge', 'harshly'])
  expect(yOutput).toMatchInlineSnapshot(`
    "? --why <string> Why are you doing this?:? --why <string> Why are you doing this?: X? --why <string> Why are you doing this?: X✔ --why <string> Why are you doing this?: X
    {"why":"X"}"
  `)
})

// something about github actions ci setup doesn't like this
testLocalOnly('promptable multiline', async () => {
  const subcommandOutput = await tsxWithMultilineInput('challenge\nharshly\ny', 'promptable', [])

  expect(subcommandOutput).toMatchInlineSnapshot(`
    "? Select a subcommand (Use arrow keys)
    ❯ challenge
      ingratiate

     Available subcommands: harshly, gently✔ Select a subcommand 
     challenge
    ? Select a challenge subcommand (Use arrow keys)
    ❯ harshly
      gently

     Challenge the user✔ Select a challenge subcommand 
     harshly
    ? --why <string> Why are you doing this?:? --why <string> Why are you doing this?: y? --why <string> Why are you doing this?: y✔ --why <string> Why are you doing this?: 
     y
    {"why":"y"}"
  `)
})
