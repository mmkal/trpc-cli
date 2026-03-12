import {expect, test, vi} from 'vitest'
import YAML from 'yaml'

import {yamlLogger} from '../src/logging.js'
import {toYaml} from '../src/yaml.js'

test('writes valid yaml for nested data', () => {
  const value = {
    name: 'trpc-cli',
    enabled: true,
    count: 3,
    items: [
      {id: 1, role: 'admin'},
      {id: 2, role: 'user'},
    ],
    nested: {
      emptyArray: [],
      emptyObject: {},
      nothing: null,
    },
  }

  const yaml = toYaml(value)

  expect(YAML.parse(yaml)).toEqual(value)
})

test('uses block strings for multiline values', () => {
  const value = {
    title: 'notes',
    body: 'first line\nsecond line',
    trailing: 'line one\n',
  }

  const yaml = toYaml(value)

  expect(yaml).toContain('body: |-')
  expect(yaml).toContain('trailing: |')
  expect(YAML.parse(yaml)).toEqual(value)
})

test('uses block strings for root multiline strings', () => {
  const value = 'first line\nsecond line'
  const yaml = toYaml(value)

  expect(yaml.startsWith('|-\n')).toBe(true)
  expect(YAML.parse(yaml)).toBe(value)
})

test('quotes ambiguous strings', () => {
  const value = {
    booly: 'true',
    nully: 'null',
    numeric: '123',
    punctuated: 'a: b',
  }

  const yaml = toYaml(value)

  expect(yaml).toContain('booly: "true"')
  expect(yaml).toContain('nully: "null"')
  expect(yaml).toContain('numeric: "123"')
  expect(yaml).toContain('punctuated: "a: b"')
  expect(YAML.parse(yaml)).toEqual(value)
})

test('yaml logger emits parseable yaml', () => {
  const info = vi.fn()
  const logger = yamlLogger({info})
  const value = {
    foo: [{job: 'typecheck', status: 'pass'}],
    message: 'hello\nworld',
  }

  logger.info?.(value)

  expect(info).toHaveBeenCalledTimes(1)
  expect(YAML.parse(info.mock.calls[0][0])).toEqual(value)
})

test('weird values', () => {
  const obj: any = {
    undefined: undefined,
    function: () => {},
    bigint: 123n,
    symbol: Symbol('symbol'),
    array: [undefined, () => {}, 123n, Symbol('symbol')],
  }
  obj.circular = obj
  obj.array.push(obj)

  expect(toYaml(obj)).toMatchInlineSnapshot(`
    "bigint: "123"
    array:
      - null
      - null
      - "123"
      - null
      - "[Circular]"
    circular: "[Circular]""
  `)
})

test('array of objects', () => {
  const obj = {
    array: [
      {file: 'greeting.txt', content: 'hello world'},
      {file: 'README.md', content: 'this is a README'},
    ],
    artifacts: ['dist/index.js', 'dist/bin.js'],
  }

  expect(toYaml(obj)).toMatchInlineSnapshot(`
    "array:
      - file: greeting.txt
        content: hello world
      - file: README.md
        content: this is a README
    artifacts:
      - dist/index.js
      - dist/bin.js"
  `)
})
