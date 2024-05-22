import {execa} from 'execa'
import * as path from 'path'
import stripAnsi from 'strip-ansi'
import {expect, test} from 'vitest'

const runner = (file: string) => async (args: string[]) => {
  const {all} = await execa('./node_modules/.bin/tsx', [`test/fixtures/${file}`, ...args], {
    all: true,
    reject: false,
    cwd: path.join(__dirname, '..'),
  }).catch(e => {
    throw new Error(`${file} ${args.join(' ')}\n${e}`)
  })
  return stripAnsi(all)
}

const calculator = runner('calculator.ts')
const migrator = runner('migrations.ts')

test('cli help', async () => {
  const output = await calculator(['--help'])
  expect(output.replaceAll(/(commands:|flags:)/gi, s => s[0].toUpperCase() + s.slice(1).toLowerCase()))
    .toMatchInlineSnapshot(`
      "Commands:
        add             Add two numbers. Use this if you have apples, and someone else has some other apples, and you want to know how many apples in total you have.
        subtract        Subtract two numbers. Useful if you have a number and you want to make it smaller.
        multiply        Multiply two numbers together. Useful if you want to count the number of tiles on your bathroom wall and are short on time.
        divide          Divide two numbers. Useful if you have a number and you want to make it smaller and \`subtract\` isn't quite powerful enough for you.

      Flags:
            --full-errors        Throw unedited raw errors rather than summarising to make more human-readable.
        -h, --help               Show help
      "
    `)
})

test('cli help add', async () => {
  const output = await calculator(['add', '--help'])
  expect(output).toMatchInlineSnapshot(`
    "add

    Add two numbers. Use this if you have apples, and someone else has some other apples, and you want to know how many apples in total you have.

    Usage:
      add [flags...]

    Flags:
      -h, --help                  Show help
          --left <number>         The first number
          --right <number>        The second number
    "
  `)
})

test('cli help divide', async () => {
  const output = await calculator(['divide', '--help'])
  expect(output).toMatchInlineSnapshot(`
    "divide v1.0.0

    Divide two numbers. Useful if you have a number and you want to make it smaller and \`subtract\` isn't quite powerful enough for you.

    Usage:
      divide [flags...]

    Flags:
      -h, --help                  Show help
          --left <number>         The numerator of the division operation.
          --right <number>        The denominator of the division operation. Note: must not be zero.

    Examples:
      divide --left 8 --right 4
    "
  `)
})

test('cli add', async () => {
  const output = await calculator(['add', '--left', '1', '--right', '2'])
  expect(output).toMatchInlineSnapshot(`"3"`)
})

test('cli add failure', async () => {
  const output = await calculator(['add', '--left', '1', '--right', 'notanumber'])
  expect(output).toMatchInlineSnapshot(`
    "Validation error
      - Expected number, received nan at "--right"
    add

    Add two numbers. Use this if you have apples, and someone else has some other apples, and you want to know how many apples in total you have.

    Usage:
      add [flags...]

    Flags:
      -h, --help                  Show help
          --left <number>         The first number
          --right <number>        The second number
    "
  `)
})

test('cli divide', async () => {
  const output = await calculator(['divide', '--left', '8', '--right', '4'])
  expect(output).toMatchInlineSnapshot(`"2"`)
})

test('cli divide failure', async () => {
  const output = await calculator(['divide', '--left', '8', '--right', '0'])
  expect(output).toMatchInlineSnapshot(`
    "Validation error
      - Invalid input at "--right"
    divide v1.0.0

    Divide two numbers. Useful if you have a number and you want to make it smaller and \`subtract\` isn't quite powerful enough for you.

    Usage:
      divide [flags...]

    Flags:
      -h, --help                  Show help
          --left <number>         The numerator of the division operation.
          --right <number>        The denominator of the division operation. Note: must not be zero.

    Examples:
      divide --left 8 --right 4
    "
  `)
})

test('migrations help', async () => {
  const output = await migrator(['--help'])
  expect(output).toMatchInlineSnapshot(`
    "Commands:
      apply                   Apply migrations. By default all pending migrations will be applied.
      create                  Create a new migration
      list                    List all migrations
      search.byName           Look for migrations by name
      search.byContent        Look for migrations by their script content

    Flags:
          --full-errors        Throw unedited raw errors rather than summarising to make more human-readable.
      -h, --help               Show help
    "
  `)
})

test('migrations union type', async () => {
  let output = await migrator(['apply', '--to', 'four'])

  expect(output).toMatchInlineSnapshot(`
    "[
      'one: executed',
      'two: executed',
      'three: executed',
      'four: executed',
      'five: pending'
    ]"
  `)

  output = await migrator(['apply', '--step', '1'])
  expect(output).toMatchInlineSnapshot(`
    "[
      'one: executed',
      'two: executed',
      'three: executed',
      'four: pending',
      'five: pending'
    ]"
  `)
})

test('migrations search.byName help', async () => {
  const output = await migrator(['search.byName', '--help'])
  expect(output).toMatchInlineSnapshot(`
    "search.byName

    Look for migrations by name

    Usage:
      search.byName [flags...]

    Flags:
      -h, --help                   Show help
          --name <string>          
      -s, --status <string>        Filter to only show migrations with this status; enum: executed,pending
    "
  `)
})

test('migrations search.byName', async () => {
  const output = await migrator(['search.byName', '--name', 'two'])
  expect(output).toMatchInlineSnapshot(`
    "[
      {
        name: 'two',
        content: 'create view two as select name from one',
        status: 'executed'
      }
    ]"
  `)
})

test('migrations search.byContent', async () => {
  const output = await migrator(['search.byContent', '--searchTerm', 'create table'])
  expect(output).toMatchInlineSnapshot(`
    "[
      {
        name: 'one',
        content: 'create table one(id int, name text)',
        status: 'executed'
      },
      {
        name: 'three',
        content: 'create table three(id int, foo int)',
        status: 'pending'
      },
      {
        name: 'five',
        content: 'create table five(id int)',
        status: 'pending'
      }
    ]"
  `)
})
