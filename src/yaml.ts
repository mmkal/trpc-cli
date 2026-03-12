type YamlScalar = string | number | boolean | null
type YamlValue = YamlScalar | YamlValue[] | {[key: string]: YamlValue}

export const toYaml = (value: unknown) => renderNode(normalizeForYaml(value, 'root', new WeakSet<object>()), 0)

function renderNode(value: YamlValue, indent: number): string {
  if (isBlockString(value)) return `${getBlockHeader(value)}\n${indentBlock(value, indent + 2)}`
  if (Array.isArray(value)) return renderArray(value, indent)
  if (isRecord(value)) return renderObject(value, indent)
  return renderScalar(value)
}

function renderArray(value: YamlValue[], indent: number): string {
  if (value.length === 0) return '[]'

  return value
    .map(item => {
      const prefix = `${' '.repeat(indent)}-`
      if (isRecord(item)) return renderObjectEntries(Object.entries(item), indent + 2, `${prefix} `, '{}')
      if (isBlockString(item)) return `${prefix} ${getBlockHeader(item)}\n${indentBlock(item, indent + 2)}`
      if (isInlineValue(item)) return `${prefix} ${renderNode(item, indent + 2)}`
      return `${prefix}\n${renderNode(item, indent + 2)}`
    })
    .join('\n')
}

function renderObject(value: {[key: string]: YamlValue}, indent: number): string {
  return renderObjectEntries(Object.entries(value), indent)
}

function renderScalar(value: YamlScalar): string {
  if (value == null) return 'null'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null'
  if (typeof value === 'boolean') return String(value)
  if (value === '') return `''`
  return isPlainString(value) ? value : JSON.stringify(value)
}

function renderKey(key: string): string {
  return isPlainString(key) ? key : JSON.stringify(key)
}

function indentBlock(value: string, indent: number): string {
  const padding = ' '.repeat(indent)
  return value
    .split('\n')
    .map(line => `${padding}${line}`)
    .join('\n')
}

function getBlockHeader(value: string): string {
  const trailingNewlines = value.match(/\n+$/)?.[0].length ?? 0
  if (trailingNewlines === 0) return '|-'
  if (trailingNewlines === 1) return '|'
  return '|+'
}

function isInlineValue(value: YamlValue): boolean {
  return (
    isScalar(value) ||
    (Array.isArray(value) && value.length === 0) ||
    (isRecord(value) && Object.keys(value).length === 0)
  )
}

function isBlockString(value: YamlValue): value is string {
  return typeof value === 'string' && value.includes('\n')
}

function isScalar(value: YamlValue): value is YamlScalar {
  return !Array.isArray(value) && !isRecord(value)
}

function isRecord(value: YamlValue): value is {[key: string]: YamlValue} {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isPlainString(value: string): boolean {
  if (value.length === 0) return false
  if (value.trim() !== value) return false
  if (/^(?:null|true|false|~)$/i.test(value)) return false
  if (/^[+-]?(?:\d+|\d*\.\d+)(?:[eE][+-]?\d+)?$/.test(value)) return false
  if (value.startsWith('[') || value.startsWith('{') || value.endsWith(']') || value.endsWith('}')) return false
  if (/[:#,!&*?|>@'"%`]/.test(value)) return false
  return !/[\r\n\t]/.test(value)
}

function renderObjectEntries(
  entries: [string, YamlValue][],
  indent: number,
  firstPrefix?: string,
  emptyValue = '{}',
): string {
  if (entries.length === 0) return emptyValue

  return entries
    .map(([key, item], index) =>
      renderObjectEntry(
        key,
        item,
        index === 0 && firstPrefix ? firstPrefix : `${' '.repeat(indent)}${renderKey(key)}:`,
        indent,
      ),
    )
    .join('\n')
}

function renderObjectEntry(key: string, item: YamlValue, prefix: string, indent: number): string {
  const linePrefix = prefix.endsWith(':') ? prefix : `${prefix}${renderKey(key)}:`
  if (isBlockString(item)) return `${linePrefix} ${getBlockHeader(item)}\n${indentBlock(item, indent + 2)}`
  if (isInlineValue(item)) return `${linePrefix} ${renderNode(item, indent + 2)}`
  return `${linePrefix}\n${renderNode(item, indent + 2)}`
}

function normalizeForYaml(value: unknown, position: 'root' | 'object' | 'array', seen: WeakSet<object>): YamlValue {
  if (value == null) return null
  if (typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'bigint') return String(value)
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') {
    return position === 'array' || position === 'root' ? null : null
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) return '[Circular]'
    seen.add(value)
    return value.map(item => normalizeForYaml(item, 'array', seen))
  }

  if (typeof value === 'object') {
    if (seen.has(value)) return '[Circular]'
    seen.add(value)

    const entries = Object.entries(value)
      .map(([key, nestedValue]) => {
        if (nestedValue === undefined || typeof nestedValue === 'function' || typeof nestedValue === 'symbol') {
          return null
        }

        return [key, normalizeForYaml(nestedValue, 'object', seen)] as const
      })
      .filter((entry): entry is readonly [string, YamlValue] => entry !== null)

    return Object.fromEntries(entries)
  }

  return null
}
