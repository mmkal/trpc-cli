import type {JsonSchema7ObjectType, JsonSchema7Type} from 'zod-to-json-schema'

const capitaliseFromCamelCase = (camel: string) => {
  const parts = camel.split(/(?=[A-Z])/)
  return capitalise(parts.map(p => p.toLowerCase()).join(' '))
}

const capitalise = (s: string) => s.slice(0, 1).toUpperCase() + s.slice(1)

export const flattenedProperties = (sch: JsonSchema7Type): JsonSchema7ObjectType['properties'] => {
  if ('properties' in sch) {
    return sch.properties
  }
  if ('allOf' in sch) {
    return Object.fromEntries(
      sch.allOf!.flatMap(subSchema => Object.entries(flattenedProperties(subSchema as JsonSchema7Type))),
    )
  }
  if ('anyOf' in sch) {
    const isExcluded = (v: JsonSchema7Type) => Object.keys(v).join(',') === 'not'
    const entries = sch.anyOf!.flatMap(subSchema => {
      const flattened = flattenedProperties(subSchema as JsonSchema7Type)
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
export const incompatiblePropertyPairs = (sch: JsonSchema7Type): Array<[string, string]> => {
  const isUnion = 'anyOf' in sch
  if (!isUnion) return []

  const sets = sch.anyOf!.map(subSchema => {
    const keys = Object.keys(flattenedProperties(subSchema as JsonSchema7Type))
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
 * Tries fairly hard to build a roughly human-readable description of a json-schema type.
 * A few common properties are given special treatment, most others are just stringified and output in `key: value` format.
 */
export const getDescription = (v: JsonSchema7Type, depth = 0): string => {
  if ('items' in v && v.items) {
    const {items, ...rest} = v
    return [getDescription(items as JsonSchema7Type, 1), getDescription(rest), 'array'].filter(Boolean).join(' ')
  }
  return (
    Object.entries(v)
      .filter(([k, vv]) => {
        if (k === 'default' || k === 'additionalProperties') return false
        if (k === 'type' && typeof vv === 'string') return depth > 0 // don't show type: string at depth 0, that's the default
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
        return `${capitaliseFromCamelCase(k)}: ${vv}`
      })
      .join('; ') || ''
  )
}

export const getPropertyTypes = (
  propertyValue: JsonSchema7Type,
): Array<'string' | 'boolean' | 'number' | (string & {})> => {
  if ('type' in propertyValue) {
    return [propertyValue.type].flat()
  }
  if ('oneOf' in propertyValue) {
    return (propertyValue.oneOf as JsonSchema7Type[]).flatMap(getPropertyTypes)
  }
  if ('anyOf' in propertyValue) {
    return (propertyValue.anyOf as JsonSchema7Type[]).flatMap(getPropertyTypes)
  }

  return []
}
