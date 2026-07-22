/*
 * Based on cli-table v0.3.11 (MIT), adapted and inlined for trpc-cli.
 * Original project: https://github.com/Automattic/cli-table
 * Copyright (c) 2010 LearnBoost <dev@learnboost.com>
 */

type Cell = {text: string; width?: number} | string | number | boolean | bigint | null | undefined
type Row = Cell[]
type ObjectRow = {[key: string]: Cell | Cell[]}
type TableRow = Row | ObjectRow

export interface CliTableOptions {
  chars?: Partial<typeof defaultChars>
  truncate?: string
  colWidths?: number[]
  colAligns?: Array<'left' | 'right' | 'middle'>
  style?: Partial<typeof defaultStyle>
  head?: string[]
  rows?: TableRow[]
}

const defaultChars = {
  top: '─',
  'top-mid': '┬',
  'top-left': '┌',
  'top-right': '┐',
  bottom: '─',
  'bottom-mid': '┴',
  'bottom-left': '└',
  'bottom-right': '┘',
  left: '│',
  'left-mid': '├',
  mid: '─',
  'mid-mid': '┼',
  right: '│',
  'right-mid': '┤',
  middle: '│',
}

const defaultStyle = {
  'padding-left': 1,
  'padding-right': 1,
  head: [] as string[],
  border: [] as string[],
  compact: false,
}

export class CliTable extends Array<TableRow> {
  options: Required<Pick<CliTableOptions, 'truncate' | 'colWidths' | 'colAligns' | 'head'>> & {
    chars: typeof defaultChars
    style: typeof defaultStyle
  }

  constructor(options: CliTableOptions = {}) {
    super()
    this.options = {
      chars: {...defaultChars, ...options.chars},
      truncate: options.truncate ?? '…',
      colWidths: [...(options.colWidths ?? [])],
      colAligns: [...(options.colAligns ?? [])],
      style: {...defaultStyle, ...options.style},
      head: [...(options.head ?? [])],
    }
    for (const row of options.rows ?? []) this.push(row)
  }

  get width() {
    const line = this.toString().split('\n')[0]
    return line?.length ?? 0
  }

  override toString() {
    const {chars, head, style, truncate} = this.options
    const colWidths = [...this.options.colWidths]
    let out = ''

    if (!head.length && !this.length) return ''

    if (!colWidths.length) {
      const allRows = head.length ? [...this, head] : [...this]
      for (const row of allRows) extractColumnWidths(row)
    }

    const totalWidth =
      (colWidths.length === 1 ? colWidths[0] : colWidths.reduce((a, b) => a + b, 0)) + colWidths.length + 1

    const drawLine = (fill: string, left: string, right: string, join: string) => {
      let width = 0
      let line = left + repeat(fill, totalWidth - 2) + right
      colWidths.forEach((columnWidth, index) => {
        if (index === colWidths.length - 1) return
        width += columnWidth + 1
        line = line.slice(0, width) + join + line.slice(width + 1)
      })
      return line
    }

    const lineTop = () => {
      const line = drawLine(chars.top, chars['top-left'], chars['top-right'], chars['top-mid'])
      if (line) out += line + '\n'
    }

    const stringifyCell = (cell: Cell, index: number) => {
      const text = String(typeof cell === 'object' && cell && 'text' in cell ? cell.text : (cell ?? ''))
      const visibleLength = strlen(text)
      const width = colWidths[index] - style['padding-left'] - style['padding-right']
      const align = this.options.colAligns[index] ?? 'left'
      const body =
        visibleLength === width
          ? text
          : visibleLength < width
            ? pad(
                text,
                width + (text.length - visibleLength),
                ' ',
                align === 'left' ? 'right' : align === 'middle' ? 'both' : 'left',
              )
            : truncateText(text, width, truncate)
      return repeat(' ', style['padding-left']) + body + repeat(' ', style['padding-right'])
    }

    const renderRow = (items: TableRow) => {
      const normalized = normalizeRow(items)
      const cells = normalized.map((item, index) => {
        const contents = String(typeof item === 'object' && item && 'text' in item ? item.text : (item ?? ''))
          .split('\n')
          .map(line => stringifyCell(line, index))
        return {contents, height: contents.length}
      })
      const maxHeight = Math.max(...cells.map(cell => cell.height), 0)
      const lines = Array.from({length: maxHeight}, () => [] as string[])

      cells.forEach((cell, index) => {
        cell.contents.forEach((line, lineIndex) => {
          lines[lineIndex].push(line)
        })
        for (let lineIndex = cell.height; lineIndex < maxHeight; lineIndex++) {
          lines[lineIndex].push(stringifyCell('', index))
        }
      })

      const body = lines.map(line => line.join(chars.middle) + chars.right).join('\n' + chars.left)

      return chars.left + body
    }

    if (head.length) {
      lineTop()
      out += renderRow(head) + '\n'
    }

    this.forEach((row, index) => {
      if (!head.length && index === 0) {
        lineTop()
      } else if (!style.compact || index < (head.length ? 1 : 0) || row.length === 0) {
        const line = drawLine(chars.mid, chars['left-mid'], chars['right-mid'], chars['mid-mid'])
        if (line) out += line + '\n'
      }

      if (hasLength(row) && row.length === 0) return
      out += renderRow(row) + '\n'
    })

    const bottom = drawLine(chars.bottom, chars['bottom-left'], chars['bottom-right'], chars['bottom-mid'])
    return bottom ? out + bottom : out.slice(0, -1)

    function extractColumnWidths(row: TableRow, offset = 0) {
      if (Array.isArray(row)) {
        row.forEach((cell, index) => {
          colWidths[index + offset] = Math.max(colWidths[index + offset] ?? 0, getWidth(cell))
        })
        return
      }

      const [headerCell, valueCell] = getSingleObjectEntry(row)
      if (headerCell == null) return
      colWidths[offset] = Math.max(colWidths[offset] ?? 0, getWidth(headerCell))
      if (Array.isArray(valueCell)) {
        valueCell.forEach((cell, index) => {
          colWidths[offset + index + 1] = Math.max(colWidths[offset + index + 1] ?? 0, getWidth(cell))
        })
        return
      }
      colWidths[offset + 1] = Math.max(colWidths[offset + 1] ?? 0, getWidth(valueCell))
    }

    function getWidth(cell: Cell) {
      const content =
        typeof cell === 'object' && cell && 'width' in cell && typeof cell.width === 'number'
          ? cell.width
          : strlen(typeof cell === 'object' && cell && 'text' in cell ? cell.text : String(cell ?? ''))
      return content + style['padding-left'] + style['padding-right']
    }

    function normalizeRow(row: TableRow): Row {
      if (Array.isArray(row)) return row
      const [key, value] = getSingleObjectEntry(row)
      if (key == null) return []
      return Array.isArray(value) ? [key, ...value] : [key, value]
    }

    function getSingleObjectEntry(row: ObjectRow) {
      const entries = Object.entries(row)
      if (entries.length > 1) {
        throw new Error(`CliTable object rows must contain exactly one entry. Got ${entries.length}.`)
      }
      return entries[0] ?? []
    }

    function hasLength(row: TableRow): row is {length: number} {
      return 'length' in row
    }
  }
}

const repeat = (value: string, times: number) => Array.from({length: times}, () => value).join('')

const pad = (value: string, len: number, padChar: string, direction: 'left' | 'right' | 'both') => {
  if (len + 1 < value.length) return value
  if (direction === 'left') return repeat(padChar, len - value.length) + value
  if (direction === 'both') {
    const padLength = len - value.length
    const right = Math.ceil(padLength / 2)
    const left = padLength - right
    return repeat(padChar, left) + value + repeat(padChar, right)
  }
  return value + repeat(padChar, len - value.length)
}

const truncateText = (value: string, length: number, truncater: string) =>
  value.length >= length ? value.slice(0, length - truncater.length) + truncater : value

const strlen = (value: unknown) => {
  const stripped = String(value).replaceAll(ansiColorPattern, '')
  return stripped.split('\n').reduce((max, line) => Math.max(max, line.length), 0)
}

const ansiColorPattern = new RegExp(String.raw`\u001b\[(?:\d*;){0,5}\d*m`, 'g')
