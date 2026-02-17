import {JSONSchema7} from 'json-schema'
import {Dependencies, Result} from './types.js'
import {zodToJsonSchema as zodV3ToJsonSchema} from './zod-to-json-schema/index.js'

const [valibotOrError, valibotToJsonSchemaOrError, effectOrError, zod4CoreOrError] = await Promise.all([
  import('valibot').catch(String),
  import('@valibot/to-json-schema').catch(String),
  import('effect').catch(String),
  import('zod/v4/core').catch(String),
])

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

const getModule = <T>(moduleOrError: T | string): T => {
  if (typeof moduleOrError === 'string') {
    throw new Error(`${moduleOrError} - try installing it and re-running`)
  }
  return moduleOrError
}

/**
 * Attempts to convert a trpc procedure input to JSON schema.
 * Uses @see jsonSchemaConverters to convert the input to JSON schema.
 */
export function toJsonSchema(input: unknown, dependencies: Dependencies): Result<JSONSchema7> {
  try {
    const jsonSchemaConverters = getJsonSchemaConverters(dependencies)
    const vendor = getVendor(input)
    if (vendor && vendor in jsonSchemaConverters) {
      const converter = jsonSchemaConverters[vendor as keyof typeof jsonSchemaConverters]
      const converted = converter(input)
      return {success: true, value: converted}
    }

    return {success: false, error: `Schema not convertible to JSON schema`}
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return {success: false, error: `Failed to convert input to JSON Schema: ${message}`}
  }
}

// #region vendor specific stuff

/** `Record<standard-schema vendor id, function that converts the input to JSON schema>` */
const getJsonSchemaConverters = (dependencies: Dependencies) => {
  return {
    zod: (input: unknown) => {
      // @ts-expect-error don't worry lots of ?.
      if (input._zod?.version?.major == 4) {
        const zod4 = getModule(zod4CoreOrError)
        return zod4.toJSONSchema(input as never, {
          io: 'input',
          // todo[zod@>=4.1.0] remove the override if https://github.com/colinhacks/zod/issues/4164 is resolved, or this comment if it's closed
          unrepresentable: 'any',
          // todo[zod@>=4.1.0] remove the override if https://github.com/colinhacks/zod/issues/4164 is resolved, or this comment if it's closed
          override: ctx => {
            if (ctx.zodSchema?.constructor?.name === 'ZodOptional') {
              ctx.jsonSchema.optional = true
            }

            // this is needed because trpc-cli (currently) has its own zod dependency, which is v3, and uses zod/v4 as a submodule. But the v3 zod/v4 module drops descriptions from the produced json schema.
            // normally zod does this itself, but not when using v3's toJSONSchema function with a v4 schema.
            const meta = (ctx.zodSchema as {} as Partial<import('zod/v4').ZodType>).meta?.()
            if (meta) Object.assign(ctx.jsonSchema, meta)
          },
        }) as JSONSchema7
      }
      return zodV3ToJsonSchema(input as never) as JSONSchema7
    },
    arktype: (input: unknown) => {
      const type = prepareArktypeType(input) as import('arktype').Type
      return type.toJsonSchema({
        fallback: ctx => {
          if (ctx.code === 'unit' && ctx.unit === undefined) return {...ctx.base, optional: true}
          return ctx.base
        },
      }) as JSONSchema7
    },
    valibot: (input: unknown) => {
      const valibotToJsonSchemaLib = dependencies['@valibot/to-json-schema'] || getModule(valibotToJsonSchemaOrError)

      const valibotToJsonSchema = valibotToJsonSchemaLib?.toJsonSchema
      if (!valibotToJsonSchema) {
        throw new Error(
          `no 'toJsonSchema' function found in @valibot/to-json-schema - check you are using a supported version`,
        )
      }
      if (typeof valibotOrError === 'string') {
        // couldn't load valibot, maybe it's aliased to something else? anyway bad luck, you won't know about optional positional parameters, but that's a rare-ish case so not a big deal
        return valibotToJsonSchema(input as never)
      }
      const v = getModule(valibotOrError)
      const parent = valibotToJsonSchema(v.object({child: input as import('valibot').StringSchema<undefined>}), {
        errorMode: 'ignore',
      })
      const child = parent.properties!.child as JSONSchema7
      return parent.required?.length === 0 ? Object.assign(child, {optional: true}) : child
    },
    effect: (input: unknown) => {
      const effect = dependencies.effect || getModule(effectOrError)
      if (!effect) {
        throw new Error(`effect dependency could not be found - try installing it and re-running`)
      }
      if (!effect.Schema.isSchema(input)) {
        const message = `input was not an effect schema - please use effect version 3.14.2 or higher. See https://github.com/mmkal/trpc-cli/pull/63`
        throw new Error(message)
      }
      return effect.JSONSchema.make(input as never) as JSONSchema7
    },
  } satisfies Record<string, (input: unknown) => JSONSchema7>
}

function getVendor(schema: unknown) {
  // note: don't check for typeof schema === 'object' because arktype schemas are functions (you call them directly instead of `.parse(...)`)
  return (schema as {['~standard']?: {vendor?: string}})?.['~standard']?.vendor ?? null
}

const jsonSchemaVendorNames = new Set(Object.keys(getJsonSchemaConverters({})))
export function looksJsonSchemaable(value: unknown) {
  const vendor = getVendor(value)
  return !!vendor && jsonSchemaVendorNames.has(vendor)
}

function prepareArktypeType(type: unknown) {
  let innerType = type as {in?: unknown; toJsonSchema: () => JSONSchema7}
  while (innerType) {
    if (innerType?.in && innerType.in !== innerType) {
      innerType = innerType.in as typeof innerType
    } else {
      break
    }
  }
  return innerType as {toJsonSchema: () => JSONSchema7}
}
// #endregion vendor specific stuff
