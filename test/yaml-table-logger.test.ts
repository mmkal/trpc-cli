import {beforeEach, expect, test, vi} from 'vitest'

import {yamlTableLogger} from '../src/logging.js'

const info = vi.fn()
const error = vi.fn()
const logger = yamlTableLogger({info, error})

beforeEach(() => {
  vi.clearAllMocks()
})

expect.addSnapshotSerializer({
  test: val => val?.mock?.calls,
  print: (val: any) => val.mock.calls.map((call: unknown[]) => call.join(' ')).join('\n'),
})

test('passes through multiple primitives', () => {
  logger.info!(1, 'two', null, false)
  expect(info).toMatchInlineSnapshot(`1 two  false`)
})

test('renders top-level flat rows as a table', () => {
  logger.info!([
    {name: 'Ada', role: 'admin'},
    {name: 'Linus', role: 'maintainer'},
  ])

  expect(info).toMatchInlineSnapshot(`
    ┌───────┬────────────┐
    │ name  │ role       │
    ├───────┼────────────┤
    │ Ada   │ admin      │
    ├───────┼────────────┤
    │ Linus │ maintainer │
    └───────┴────────────┘
  `)
})

test('renders nested values as yaml inside cells', () => {
  logger.info!([
    {
      job: 'typecheck',
      meta: {node: 22, platform: 'darwin'},
      artifacts: ['dist/index.js', 'dist/bin.js'],
    },
    {
      job: 'test',
      meta: {node: 20, platform: 'linux'},
      artifacts: ['coverage/index.html'],
    },
  ])

  expect(info).toMatchInlineSnapshot(`
    ┌───────────┬──────────────────┬───────────────────────┐
    │ job       │ meta             │ artifacts             │
    ├───────────┼──────────────────┼───────────────────────┤
    │ typecheck │ node: 22         │ - dist/index.js       │
    │           │ platform: darwin │ - dist/bin.js         │
    ├───────────┼──────────────────┼───────────────────────┤
    │ test      │ node: 20         │ - coverage/index.html │
    │           │ platform: linux  │                       │
    └───────────┴──────────────────┴───────────────────────┘
  `)
})

test('renders sibling lists as separate tables', () => {
  logger.info!({
    list1: [
      {foo: 'abc', bar: 'def'},
      {foo: 'xyz', bar: 'zyx'},
    ],
    list2: [
      {hello: 123, goodbye: 456},
      {hello: 987, goodbye: 789},
    ],
  })

  expect(info).toMatchInlineSnapshot(`
    list1:
    ┌─────┬─────┐
    │ foo │ bar │
    ├─────┼─────┤
    │ abc │ def │
    ├─────┼─────┤
    │ xyz │ zyx │
    └─────┴─────┘

    list2:
    ┌───────┬─────────┐
    │ hello │ goodbye │
    ├───────┼─────────┤
    │ 123   │ 456     │
    ├───────┼─────────┤
    │ 987   │ 789     │
    └───────┴─────────┘
  `)
})

test('renders mixed object as table sections plus yaml details', () => {
  logger.info!({
    jobs: [
      {name: 'lint', status: 'pass'},
      {name: 'test', status: 'fail'},
    ],
    summary: {passed: 1, failed: 1},
    branch: 'main',
  })

  expect(info).toMatchInlineSnapshot(`
    jobs:
    ┌──────┬────────┐
    │ name │ status │
    ├──────┼────────┤
    │ lint │ pass   │
    ├──────┼────────┤
    │ test │ fail   │
    └──────┴────────┘

    details:
    summary:
      passed: 1
      failed: 1
    branch: main
  `)
})

test('falls back to yaml for non-tabular objects', () => {
  logger.info!({
    project: 'trpc-cli',
    summary: {passed: 10, failed: 2},
    owners: ['mmkal', 'ci'],
  })

  expect(info).toMatchInlineSnapshot(`
    project: trpc-cli
    summary:
      passed: 10
      failed: 2
    owners:
      - mmkal
      - ci
  `)
})

test('truncates very tall yaml cells', () => {
  logger.info!([
    {
      file: 'big.txt',
      content: {
        a: '1',
        b: '2',
        c: '3',
        d: '4',
        e: '5',
        f: '6',
        g: '7',
      },
    },
  ])

  expect(info).toMatchInlineSnapshot(`
    ┌─────────┬─────────┐
    │ file    │ content │
    ├─────────┼─────────┤
    │ big.txt │ a: "1"  │
    │         │ b: "2"  │
    │         │ c: "3"  │
    │         │ d: "4"  │
    │         │ e: "5"  │
    │         │ f: "6"  │
    │         │ ...     │
    └─────────┴─────────┘
  `)
})

test('handles circular values inside cells', () => {
  const circular: {name: string; self?: unknown} = {name: 'Ada'}
  circular.self = circular

  logger.info!([{user: circular}])

  expect(info).toMatchInlineSnapshot(`
    ┌────────────────────┐
    │ user               │
    ├────────────────────┤
    │ name: Ada          │
    │ self: "[Circular]" │
    └────────────────────┘
  `)
})

test('renders primitive arrays as yaml fallback', () => {
  logger.info!(['a', 'b', {x: 1}])
  expect(info).toMatchInlineSnapshot(`
    - a
    - b
    - x: 1
  `)
})

test('logs errors too', () => {
  logger.error!({
    failures: [
      {file: 'logging.test.ts', reason: 'nested output'},
      {file: 'yaml.test.ts', reason: 'weird values'},
    ],
  })

  expect(error).toMatchInlineSnapshot(`
    failures:
    ┌─────────────────┬───────────────┐
    │ file            │ reason        │
    ├─────────────────┼───────────────┤
    │ logging.test.ts │ nested output │
    ├─────────────────┼───────────────┤
    │ yaml.test.ts    │ weird values  │
    └─────────────────┴───────────────┘
  `)
})
