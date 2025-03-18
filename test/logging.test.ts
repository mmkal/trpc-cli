import {beforeEach, expect, test, vi} from 'vitest'
import {lineByLineLogger} from '../src/logging'

const info = vi.fn()
const error = vi.fn()
const mocks = {info, error}
const jsonish = lineByLineLogger(mocks)

beforeEach(() => {
  vi.clearAllMocks()
})

expect.addSnapshotSerializer({
  test: val => val?.mock?.calls,
  print: (val: any) => val.mock.calls.map((call: unknown[]) => call.join(' ')).join('\n'),
})

expect.addSnapshotSerializer({
  test: val => val?.cause && val.message,
  serialize(val, config, indentation, depth, refs, printer) {
    indentation += '  '
    return `[${val.constructor.name}: ${val.message}]\n${indentation}Caused by: ${printer(val.cause, config, indentation, depth + 1, refs)}`
  },
})

test('an error', () => {
  const e = new Error('outer', {cause: new Error('middle', {cause: new Error('inner')})})
  expect(e).toMatchInlineSnapshot(`
    [Error: outer]
      Caused by: [Error: middle]
        Caused by: [Error: inner]
  `)
})

test('logging', async () => {
  jsonish.info!('Hello', 'world')

  expect(info).toMatchInlineSnapshot(`Hello world`)
})

test('string array', async () => {
  jsonish.info!(['m1', 'm2', 'm3'])

  expect(info).toMatchInlineSnapshot(`
    m1
    m2
    m3
  `)
})

test('primitives array', async () => {
  jsonish.info!(['m1', 'm2', 11, true, 'm3'])

  expect(info).toMatchInlineSnapshot(`
    m1
    m2
    11
    true
    m3
  `)
})

test('array array', async () => {
  jsonish.info!([
    ['m1', 'm2'],
    ['m3', 'm4'],
  ])

  expect(info).toMatchInlineSnapshot(`
    [
      "m1",
      "m2"
    ]
    [
      "m3",
      "m4"
    ]
  `)
})

test('multi primitives', async () => {
  jsonish.info!('m1', 11, true, 'm2')
  jsonish.info!('m1', 12, false, 'm2')

  expect(info).toMatchInlineSnapshot(`
    m1 11 true m2
    m1 12 false m2
  `)
})

test('object array', async () => {
  jsonish.info!([{name: 'm1'}, {name: 'm2'}, {name: 'm3'}])

  expect(info).toMatchInlineSnapshot(`
    {
      "name": "m1"
    }
    {
      "name": "m2"
    }
    {
      "name": "m3"
    }
  `)
})
