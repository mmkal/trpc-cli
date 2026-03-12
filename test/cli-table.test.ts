import {expect, test} from 'vitest'

import {CliTable} from '../src/cli-table.js'

test('complete table', () => {
  const table = new CliTable({
    head: ['Rel', 'Change', 'By', 'When'],
    colWidths: [6, 21, 25, 17],
  })

  table.push(
    ['v0.1', 'Testing something cool', 'rauchg@gmail.com', '7 minutes ago'],
    ['v0.1', 'Testing something cool', 'rauchg@gmail.com', '8 minutes ago'],
  )

  expect(table.toString()).toBe(
    [
      '┌──────┬─────────────────────┬─────────────────────────┬─────────────────┐',
      '│ Rel  │ Change              │ By                      │ When            │',
      '├──────┼─────────────────────┼─────────────────────────┼─────────────────┤',
      '│ v0.1 │ Testing something … │ rauchg@gmail.com        │ 7 minutes ago   │',
      '├──────┼─────────────────────┼─────────────────────────┼─────────────────┤',
      '│ v0.1 │ Testing something … │ rauchg@gmail.com        │ 8 minutes ago   │',
      '└──────┴─────────────────────┴─────────────────────────┴─────────────────┘',
    ].join('\n'),
  )
})

test('width property', () => {
  const table = new CliTable({head: ['Cool']})
  expect(table.width).toBe(8)
})

test('vertical table output', () => {
  const table = new CliTable({
    style: {'padding-left': 0, 'padding-right': 0},
  })

  table.push({'v0.1': 'Testing something cool'}, {'v0.1': 'Testing something cool'})

  expect(table.toString()).toBe(
    [
      '┌────┬──────────────────────┐',
      '│v0.1│Testing something cool│',
      '├────┼──────────────────────┤',
      '│v0.1│Testing something cool│',
      '└────┴──────────────────────┘',
    ].join('\n'),
  )
})

test('cross table output', () => {
  const table = new CliTable({
    head: ['', 'Header 1', 'Header 2'],
    style: {'padding-left': 0, 'padding-right': 0},
  })

  table.push({'Header 3': ['v0.1', 'Testing something cool']}, {'Header 4': ['v0.1', 'Testing something cool']})

  expect(table.toString()).toBe(
    [
      '┌────────┬────────┬──────────────────────┐',
      '│        │Header 1│Header 2              │',
      '├────────┼────────┼──────────────────────┤',
      '│Header 3│v0.1    │Testing something cool│',
      '├────────┼────────┼──────────────────────┤',
      '│Header 4│v0.1    │Testing something cool│',
      '└────────┴────────┴──────────────────────┘',
    ].join('\n'),
  )
})

test('custom chars', () => {
  const table = new CliTable({
    chars: {
      top: '═',
      'top-mid': '╤',
      'top-left': '╔',
      'top-right': '╗',
      bottom: '═',
      'bottom-mid': '╧',
      'bottom-left': '╚',
      'bottom-right': '╝',
      left: '║',
      'left-mid': '╟',
      right: '║',
      'right-mid': '╢',
    },
  })

  table.push(['foo', 'bar', 'baz'], ['frob', 'bar', 'quuz'])

  expect(table.toString()).toBe(
    [
      '╔══════╤═════╤══════╗',
      '║ foo  │ bar │ baz  ║',
      '╟──────┼─────┼──────╢',
      '║ frob │ bar │ quuz ║',
      '╚══════╧═════╧══════╝',
    ].join('\n'),
  )
})

test('compact shorthand', () => {
  const table = new CliTable({style: {compact: true}})

  table.push(['foo', 'bar', 'baz'], ['frob', 'bar', 'quuz'])

  expect(table.toString()).toBe(
    ['┌──────┬─────┬──────┐', '│ foo  │ bar │ baz  │', '│ frob │ bar │ quuz │', '└──────┴─────┴──────┘'].join('\n'),
  )
})

test('compact empty mid line', () => {
  const table = new CliTable({
    chars: {
      mid: '',
      'left-mid': '',
      'mid-mid': '',
      'right-mid': '',
    },
  })

  table.push(['foo', 'bar', 'baz'], ['frob', 'bar', 'quuz'])

  expect(table.toString()).toBe(
    ['┌──────┬─────┬──────┐', '│ foo  │ bar │ baz  │', '│ frob │ bar │ quuz │', '└──────┴─────┴──────┘'].join('\n'),
  )
})

test('decoration lines disabled', () => {
  const table = new CliTable({
    chars: {
      top: '',
      'top-mid': '',
      'top-left': '',
      'top-right': '',
      bottom: '',
      'bottom-mid': '',
      'bottom-left': '',
      'bottom-right': '',
      left: '',
      'left-mid': '',
      mid: '',
      'mid-mid': '',
      right: '',
      'right-mid': '',
      middle: ' ',
    },
    style: {'padding-left': 0, 'padding-right': 0},
  })

  table.push(['foo', 'bar', 'baz'], ['frobnicate', 'bar', 'quuz'])

  expect(table.toString()).toBe(['foo        bar baz ', 'frobnicate bar quuz'].join('\n'))
})

test('rows option in constructor', () => {
  const table = new CliTable({
    rows: [
      ['foo', '7 minutes ago'],
      ['bar', '8 minutes ago'],
    ],
  })

  expect(table.toString()).toBe(
    [
      '┌─────┬───────────────┐',
      '│ foo │ 7 minutes ago │',
      '├─────┼───────────────┤',
      '│ bar │ 8 minutes ago │',
      '└─────┴───────────────┘',
    ].join('\n'),
  )
})

test('table with no options provided in constructor', () => {
  expect(new CliTable()).toBeTruthy()
})

test('table with newlines in headers', () => {
  const table = new CliTable({head: ['Test', '1\n2\n3']})

  expect(table.toString()).toBe(
    ['┌──────┬───┐', '│ Test │ 1 │', '│      │ 2 │', '│      │ 3 │', '└──────┴───┘'].join('\n'),
  )
})

test('column width reflects newlines', () => {
  const table = new CliTable({head: ['Test\nWidth']})
  expect(table.width).toBe(9)
})

test('newlines in body cells', () => {
  const table = new CliTable()

  table.push(['something\nwith\nnewlines'])

  expect(table.toString()).toBe(
    ['┌───────────┐', '│ something │', '│ with      │', '│ newlines  │', '└───────────┘'].join('\n'),
  )
})

test('newlines in vertical cell header and body', () => {
  const table = new CliTable({
    style: {'padding-left': 0, 'padding-right': 0},
  })

  table.push({'v\n0.1': 'Testing\nsomething cool'})

  expect(table.toString()).toBe(
    ['┌───┬──────────────┐', '│v  │Testing       │', '│0.1│something cool│', '└───┴──────────────┘'].join('\n'),
  )
})

test('newlines in cross table header and body', () => {
  const table = new CliTable({
    head: ['', 'Header\n1'],
    style: {'padding-left': 0, 'padding-right': 0},
  })

  table.push({'Header\n2': ['Testing\nsomething\ncool']})

  expect(table.toString()).toBe(
    [
      '┌──────┬─────────┐',
      '│      │Header   │',
      '│      │1        │',
      '├──────┼─────────┤',
      '│Header│Testing  │',
      '│2     │something│',
      '│      │cool     │',
      '└──────┴─────────┘',
    ].join('\n'),
  )
})

test('object rows must contain exactly one entry', () => {
  const table = new CliTable()

  table.push({a: 1, b: 2})

  expect(() => table.toString()).toThrowError('CliTable object rows must contain exactly one entry. Got 2.')
})
