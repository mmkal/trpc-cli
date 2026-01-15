import {JSONSchema7} from 'json-schema'

const capitaliseFromCamelCase = (camel: string) => {
  const parts = camel.split(/(?=[A-Z])/)
  return capitalise(parts.map(p => p.toLowerCase()).join(' '))
}

const capitalise = (s: string) => s.slice(0, 1).toUpperCase() + s.slice(1)

export const flattenedProperties = (sch: JSONSchema7): Record<string, JSONSchema7> => {
  if ('properties' in sch) {
    return sch.properties as Record<string, JSONSchema7>
  }
  if ('allOf' in sch) {
    return Object.fromEntries(
      sch.allOf!.flatMap(subSchema => Object.entries(flattenedProperties(subSchema as JSONSchema7))),
    )
  }
  if ('anyOf' in sch) {
    const isExcluded = (v: JSONSchema7) => Object.keys(v).join(',') === 'not'
    const entries = sch.anyOf!.flatMap(subSchema => {
      const flattened = flattenedProperties(subSchema as JSONSchema7)
      const excluded = Object.entries(flattened).flatMap(([name, propSchema]) => {
        return isExcluded(propSchema) ? [`--${name}`] : []
      })
      return Object.entries(flattened).map(([k, v]): [typeof k, typeof v] => {
        if (!isExcluded(v) && excluded.length > 0) {
          return [k, Object.assign({}, v, {'Do not use with': excluded}) as typeof v]
        }
        return [k, v]
      })
    })

    return Object.fromEntries(
      entries.sort((a, b) => {
        const scores = [a, b].map(([_k, v]) => (isExcluded(v) ? 0 : 1)) // Put the excluded ones first, so that `Object.fromEntries` will override them with the non-excluded ones (`Object.fromEntries([['a', 1], ['a', 2]])` => `{a: 2}`)
        return scores[0] - scores[1]
      }),
    )
  }
  return {}
}
/** For a union type, returns a list of pairs of properties which *shouldn't* be used together (because they don't appear in the same type variant) */
export const incompatiblePropertyPairs = (sch: JSONSchema7): Array<[string, string]> => {
  const isUnion = 'anyOf' in sch
  if (!isUnion) return []

  const sets = sch.anyOf!.map(subSchema => {
    const keys = Object.keys(flattenedProperties(subSchema as JSONSchema7))
    return {keys, set: new Set(keys)}
  })

  const compatiblityEntries = sets.flatMap(({keys}) => {
    return keys.map(key => {
      return [key, new Set(sets.filter(other => other.set.has(key)).flatMap(other => other.keys))] as const
    })
  })
  const allKeys = sets.flatMap(({keys}) => keys)

  return compatiblityEntries.flatMap(([key, compatibleWith]) => {
    const incompatibleEntries = allKeys
      .filter(other => key < other && !compatibleWith.has(other))
      .map((other): [string, string] => [key, other])
    return incompatibleEntries
  })
}
/**
 * Checks if anyOf represents a simple type union (e.g., {anyOf: [{type: 'boolean'}, {type: 'number'}]})
 * Returns the types if it is, null otherwise.
 */
const getSimpleTypeUnion = (v: JSONSchema7): string[] | null => {
  if (!('anyOf' in v) || !Array.isArray(v.anyOf)) return null
  const types: string[] = []
  for (const sub of v.anyOf) {
    if (
      sub &&
      typeof sub === 'object' &&
      'type' in sub &&
      typeof sub.type === 'string' &&
      Object.keys(sub).length === 1
    ) {
      types.push(sub.type)
    } else {
      return null // not a simple type union
    }
  }
  return types.length > 0 ? types : null
}

/**
 * Tries fairly hard to build a roughly human-readable description of a json-schema type.
 * A few common properties are given special treatment, most others are just stringified and output in `key: value` format.
 */
export const getDescription = (v: JSONSchema7, depth = 0): string => {
  if ('items' in v && v.items) {
    const {items, ...rest} = v
    return [getDescription(items as JSONSchema7, 1), getDescription(rest), 'array'].filter(Boolean).join(' ')
  }

  // Check for simple type unions like {anyOf: [{type: 'boolean'}, {type: 'number'}]}
  // These should render as "type: boolean or number" not "anyOf: [...]"
  const simpleTypeUnion = getSimpleTypeUnion(v)

  const parts = Object.entries(v)
    .filter(([k, vv]) => {
      if (k === 'default' || k === 'additionalProperties' || k === 'optional') return false
      if (k === 'type' && typeof vv === 'string') return depth > 0 // don't show type: string at depth 0, that's the default
      if (k.startsWith('$')) return false // helpers props to add on to a few different external library output formats
      if (k === 'maximum' && vv === Number.MAX_SAFE_INTEGER) return false // zod adds this for `z.number().int().positive()`
      if (depth <= 1 && k === 'enum' && getEnumChoices(v)?.type === 'string_enum') return false // don't show Enum: ["a","b"], that's handled by commander's `choices`
      // don't show anyOf: [...] when it's enum choices handled by commander
      if (depth <= 1 && k === 'anyOf' && getEnumChoices(v)?.type === 'string_enum') return false
      // don't show anyOf: [...] for simple type unions - we'll render it as "type: X or Y" instead
      if (k === 'anyOf' && simpleTypeUnion) return false
      return true
    })
    .sort(([a], [b]) => {
      const scores = [a, b].map(k => (k === 'description' ? 0 : 1))
      return scores[0] - scores[1]
    })
    .map(([k, vv], i) => {
      if (k === 'type' && Array.isArray(vv)) return `type: ${vv.join(' or ')}`
      if (k === 'description' && i === 0) return String(vv)
      if (k === 'properties') return `Object (json formatted)`
      if (typeof vv === 'object') return `${capitaliseFromCamelCase(k)}: ${JSON.stringify(vv)}`
      return `${capitaliseFromCamelCase(k)}: ${vv}`
    })

  // If we have a simple type union, add it to the description
  if (simpleTypeUnion) {
    parts.push(`type: ${simpleTypeUnion.join(' or ')}`)
  }

  // For string enums (including union of string literals), add "Type: string" at depth 1
  // This ensures arrays of union literals show "Type: string array" not just "array"
  const enumType = getEnumChoices(v)
  if (depth > 0 && enumType?.type === 'string_enum' && !('type' in v)) {
    parts.unshift('Type: string')
  }

  return parts.join('; ') || ''
}

export const getSchemaTypes = (
  propertyValue: JSONSchema7,
): Array<'string' | 'boolean' | 'number' | 'integer' | (string & {})> => {
  const array: string[] = []
  if ('type' in propertyValue) {
    array.push(...[propertyValue.type!].flat())
  }
  if ('enum' in propertyValue && Array.isArray(propertyValue.enum)) {
    array.push(...propertyValue.enum.flatMap(s => typeof s))
  }
  if ('const' in propertyValue && propertyValue.const === null) {
    array.push('null')
  } else if ('const' in propertyValue) {
    array.push(typeof propertyValue.const)
  }
  if ('oneOf' in propertyValue) {
    array.push(...(propertyValue.oneOf as JSONSchema7[]).flatMap(getSchemaTypes))
  }
  if ('anyOf' in propertyValue) {
    array.push(...(propertyValue.anyOf as JSONSchema7[]).flatMap(getSchemaTypes))
  }

  return [...new Set(array)]
}

/** Returns a list of all allowed subschemas. If the schema is not a union, returns a list with a single item. */
export const getAllowedSchemas = (schema: JSONSchema7): JSONSchema7[] => {
  if (!schema) return []
  if ('anyOf' in schema && Array.isArray(schema.anyOf))
    return (schema.anyOf as JSONSchema7[]).flatMap(getAllowedSchemas)
  if ('oneOf' in schema && Array.isArray(schema.oneOf))
    return (schema.oneOf as JSONSchema7[]).flatMap(getAllowedSchemas)
  const types = getSchemaTypes(schema)
  if (types.length === 1) return [schema]
  return types.map(type => ({...schema, type}) as JSONSchema7)
}

export const getEnumChoices = (propertyValue: JSONSchema7) => {
  if (!propertyValue) return null
  if (!('enum' in propertyValue && Array.isArray(propertyValue.enum))) {
    // arktype prefers {anyOf: [{const: 'foo'}, {const: 'bar'}]} over {enum: ['foo', 'bar']} 🤷
    // zod 4 produces {anyOf: [{type: 'string', const: 'foo'}, {type: 'string', const: 'bar'}]}
    if (
      'anyOf' in propertyValue &&
      propertyValue.anyOf?.every(subSchema => {
        if (subSchema && typeof subSchema === 'object' && 'const' in subSchema && typeof subSchema.const === 'string') {
          // Allow {const: 'foo'} or {type: 'string', const: 'foo'}
          const keys = Object.keys(subSchema)
          return keys.length === 1 || (keys.length === 2 && 'type' in subSchema && subSchema.type === 'string')
        }
        return false
      })
    ) {
      // all the subschemas are string literals, so we can use them as choices
      return {
        type: 'string_enum',
        choices: propertyValue.anyOf.map(subSchema => (subSchema as {const: string}).const),
      } as const
    }

    if (
      'anyOf' in propertyValue &&
      propertyValue.anyOf?.every(subSchema => {
        if (subSchema && typeof subSchema === 'object' && 'const' in subSchema && typeof subSchema.const === 'number') {
          // Allow {const: 123} or {type: 'number', const: 123} or {type: 'integer', const: 123}
          const keys = Object.keys(subSchema)
          return (
            keys.length === 1 ||
            (keys.length === 2 && 'type' in subSchema && (subSchema.type === 'number' || subSchema.type === 'integer'))
          )
        }
        return false
      })
    ) {
      // all the subschemas are number literals, so we can use them as choices
      return {
        type: 'number_enum',
        choices: propertyValue.anyOf.map(subSchema => (subSchema as {const: number}).const),
      } as const
    }

    return null
  }

  if (propertyValue.enum.every(s => typeof s === 'string')) {
    return {
      type: 'string_enum',
      choices: propertyValue.enum,
    } as const
  }

  // commander doesn't like number enums - could enable with a parser but let's avoid for now
  if (propertyValue.enum.every(s => typeof s === 'number')) {
    return {
      type: 'number_enum',
      choices: propertyValue.enum,
    } as const
  }

  return null
}
