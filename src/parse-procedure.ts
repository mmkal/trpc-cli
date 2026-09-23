import {InvalidArgumentError} from 'commander'
import type {JSONSchema7, JSONSchema7Definition} from 'json-schema'
import {inspect} from 'util'
import {CliValidationError} from './errors.js'
import {getSchemaTypes, looksJsonSchemaable, toJsonSchema} from './json-schema.js'
import type {ArgvLocation, Dependencies, ParsedProcedure, Result} from './types.js'

function looksLikeJsonSchema(value: unknown): value is JSONSchema7 & {type: string} {
  return (
    typeof value === 'object' &&
    value !== null &&
    (('type' in value && (typeof value.type === 'string' || Array.isArray(value.type))) ||
      'const' in value ||
      'oneOf' in value ||
      'anyOf' in value)
  )
}

export function getProcedureInputJsonSchemas(inputs: unknown[], dependencies: Dependencies): Result<JSONSchema7[]> {
  const allJsonSchemaable = inputs.every(input => looksJsonSchemaable(input))
  if (!allJsonSchemaable) {
    return {
      success: false,
      error: `Invalid input type ${inputs.map(s => (s as {})?.constructor.name).join(', ')}, only inputs that can be converted to JSON Schema are supported`,
    }
  }

  const converted = inputs.map(input => toJsonSchema(input, dependencies))
  if (converted.some(c => !c.success)) {
    return {
      success: false,
      error: converted.flatMap(c => (c.success ? [] : [c.error])).join('\n'),
    }
  }

  const schemas = converted.map(c => (c as Extract<typeof c, {success: true}>).value)
  return {success: true, value: schemas}
}

export function parseJsonSchemaInputs(schemas: Result<JSONSchema7[]>): Result<ParsedProcedure> {
  const inner = parseProcedureInputsInner(schemas)
  if (inner.success && inner.value.positionalParameters.some((param, i, {length}) => param.array && i < length - 1)) {
    return {success: false, error: `Array positional parameters must be at the end of the input.`}
  }

  if (inner.success) {
    const optionsProps = schemaDefPropValue(inner.value.optionsJsonSchema, 'properties')
    if (optionsProps) {
      const optionishPositionals = Object.entries(optionsProps).flatMap(([key, schema]) => {
        if (typeof schema === 'object' && 'positional' in schema && schema.positional === true) {
          return [{key, schema}]
        }
        return []
      })

      if (optionishPositionals.length > 0) {
        return {
          success: true,
          value: {
            positionalParameters: [
              ...inner.value.positionalParameters,
              ...optionishPositionals.map(({key, schema}): (typeof inner.value.positionalParameters)[number] => ({
                name: key,
                array: looksLikeArray(schema),
                description: schema.description ?? '',
                required: !isOptional(schema),
                type: getSchemaTypes(schema).join(' | '),
              })),
            ],
            optionsJsonSchema: {
              ...inner.value.optionsJsonSchema,
              properties: Object.fromEntries(
                Object.entries(optionsProps).filter(([key]) => !optionishPositionals.some(x => x.key === key)),
              ),
            } as JSONSchema7,
            getPojoInput: params => {
              const positionalValues = [...params.positionalValues]
              const options = {...params.options}
              for (const {key, schema} of optionishPositionals) {
                const value = positionalValues.shift()
                options[key] = Array.isArray(value)
                  ? value.map(v => coercePositional(toRoughJsonSchema7(schema).items as JSONSchema7, v))
                  : coercePositional(schema, value)
              }

              return inner.value.getPojoInput({positionalValues, options})
            },
            getArgvLocation: path => {
              const location = inner.value.getArgvLocation(path)
              if (location?.type !== 'option') return location
              const positionalIndex = optionishPositionals.findIndex(({key}) => key === location.key)
              if (positionalIndex === -1) return location
              return {
                type: 'positional',
                index: inner.value.positionalParameters.length + positionalIndex,
                path: location.path,
              }
            },
          },
        }
      }
    }
  }

  return inner
}

function parseProcedureInputsInner(schemasResult: Result<JSONSchema7[]>): Result<ParsedProcedure> {
  if (!schemasResult.success) return schemasResult

  const schemas = schemasResult.value

  if (schemas.length === 0) {
    return {
      success: true,
      value: {
        positionalParameters: [],
        optionsJsonSchema: {},
        getPojoInput: () => ({}),
        getArgvLocation: () => undefined,
      },
    }
  }

  if (schemas.length > 1) {
    return parseMultiInputs(schemas)
  }

  const mergedSchema = schemas[0]
  return handleMergedSchema(mergedSchema)
}

function handleMergedSchema(mergedSchema: JSONSchema7): Result<ParsedProcedure> {
  if (mergedSchema.additionalProperties) {
    return {success: false, error: `Inputs with additional properties are not currently supported`}
  }

  if (acceptedPrimitiveTypes(mergedSchema).length > 0) {
    return parsePrimitiveInput(mergedSchema)
  }

  if (isTuple(mergedSchema)) {
    return parseTupleInput(mergedSchema)
  }

  if (mergedSchema.type === 'array') {
    return parseArrayInput(mergedSchema as JSONSchema7 & {items: {type: unknown}})
  }

  if (mergedSchema.anyOf) {
    const nonOptionalSchemas = mergedSchema.anyOf.filter(sub => !isOptional(sub)).map(toRoughJsonSchema7)
    if (nonOptionalSchemas.length === 1) {
      return handleMergedSchema(nonOptionalSchemas[0])
    }

    const allObjects = mergedSchema.anyOf.every(sub => acceptsObject(toRoughJsonSchema7(sub)))
    if (allObjects) {
      return {
        success: true,
        value: {
          positionalParameters: [],
          optionsJsonSchema: mergedSchema,
          getPojoInput: argv => argv.options,
          getArgvLocation: optionLocation,
        },
      }
    }
  }

  if (mergedSchema.type !== 'object') {
    return {
      success: false,
      error: `Invalid input type ${inspect(mergedSchema, {depth: 2, breakLength: Infinity})}, expected object or tuple.`,
    }
  }

  return {
    success: true,
    value: {
      positionalParameters: [],
      optionsJsonSchema: mergedSchema,
      getPojoInput: argv => argv.options,
      getArgvLocation: optionLocation,
    },
  }
}

// zod-to-json-schema turns `z.string().optional()` into `{"anyOf":[{"not":{}},{"type":"string"}]}`
export function isOptional(schema: JSONSchema7Definition) {
  if (schema && typeof schema === 'object' && 'optional' in schema) return schema.optional === true
  if (hasUndefinedType(schema)) return true
  if (schemaDefPropValue(schema, 'not') && JSON.stringify(schema) === '{"not":{}}') return true
  const anyOf = schemaDefPropValue(schema, 'anyOf')
  if (anyOf?.some(sub => isOptional(sub))) return true
  if (schemaDefPropValue(schema, 'default') !== undefined) return true
  return false
}

// typebox uses the non-standard `{type: 'undefined'}` schema in optional unions like `Type.Union([Type.String(), Type.Undefined()])`
function hasUndefinedType(schema: JSONSchema7Definition) {
  const type = schema && typeof schema === 'object' ? (schema as {type?: unknown}).type : undefined
  return type === 'undefined' || (Array.isArray(type) && type.includes('undefined'))
}

function parsePrimitiveInput(schema: JSONSchema7): Result<ParsedProcedure> {
  const typeName = acceptedPrimitiveTypes(schema).join(' | ')
  const name = (schema.title || schema.description || /\W/.test(typeName) ? 'value' : typeName).replaceAll(/\s+/g, '_')
  return {
    success: true,
    value: {
      positionalParameters: [
        {
          name,
          array: false,
          description: schema.description || '',
          required: !isOptional(schema),
          type: typeName,
        },
      ],
      optionsJsonSchema: {},
      getPojoInput: argv => coercePositional(schema, argv.positionalValues[0] as string | undefined),
      getArgvLocation: path => ({type: 'positional', index: 0, path}),
    },
  }
}

const schemaDefPropValue = <K extends keyof JSONSchema7>(
  schema: JSONSchema7Definition,
  prop: K,
): JSONSchema7[K] | undefined => {
  if (schema && typeof schema === 'object' && prop in schema) return schema[prop]
  return undefined
}

const primitiveCandidateTypes = ['string', 'number', 'boolean', 'integer'] as const
function acceptedPrimitiveTypes(schema: JSONSchema7Definition): Array<(typeof primitiveCandidateTypes)[number]> {
  let constVals: string[] | undefined = [toRoughJsonSchema7(schema).const, toRoughJsonSchema7(schema).enum]
    .flat()
    .filter(Boolean)
    .map(s => typeof s)
  if (constVals.length === 0) constVals = undefined
  const typeList =
    constVals ||
    schemaDefPropValue(schema, 'type') ||
    schemaDefPropValue(schema, 'oneOf')?.flatMap(s => acceptedPrimitiveTypes(s)) ||
    schemaDefPropValue(schema, 'anyOf')?.flatMap(s => acceptedPrimitiveTypes(s))
  const acceptedJsonSchemaTypes = new Set([typeList].flat().filter(Boolean))
  return primitiveCandidateTypes.filter(c => acceptedJsonSchemaTypes.has(c))
}

/**
 * From a list of schemas, if they are all record-style schemas, return a single schema with all properties (an intersection).
 * Returns `null` if the schemas are not all record-style schemas.
 */
function maybeMergeObjectSchemas(schemas: JSONSchema7[]): JSONSchema7 | null {
  const required: string[] = []
  const properties: Record<string, JSONSchema7> = {}
  for (const schema of schemas) {
    if (!schema) return null
    const {required: schemaRequired, properties: schemaProperties, type, $schema, ...rest} = schema
    if (type && type !== 'object') return null
    if (Object.keys(rest).length) return null
    if (schemaRequired) required.push(...schemaRequired)
    if (schemaProperties) Object.assign(properties, schemaProperties)
  }
  return {type: 'object', required, properties}
}

function parseMultiInputs(schemas: JSONSchema7[]): Result<ParsedProcedure> {
  const parsedIndividually = schemas.map(sch => parseProcedureInputsInner({success: true, value: [sch]}))

  const failures = parsedIndividually.flatMap(p => (p.success ? [] : [p.error]))
  if (failures.length > 0) {
    return {success: false, error: failures.join('\n')}
  }

  const allObjects = parsedIndividually.every(p => p.success && p.value.positionalParameters.length === 0)
  if (!allObjects) {
    return {
      success: false,
      error: `Can't use positional parameters with multi-input type.`,
    }
  }

  const merged = maybeMergeObjectSchemas(parsedIndividually.map(p => (p.success ? p.value.optionsJsonSchema : {})))
  if (merged) {
    return {
      success: true,
      value: {
        positionalParameters: [],
        optionsJsonSchema: merged,
        getPojoInput: argv => argv.options,
        getArgvLocation: optionLocation,
      },
    }
  }

  return {
    success: true,
    value: {
      positionalParameters: [],
      optionsJsonSchema: {
        allOf: parsedIndividually.map(p => {
          const successful = p as Extract<typeof p, {success: true}>
          const optionsSchema = successful.value.optionsJsonSchema
          if ('additionalProperties' in optionsSchema && optionsSchema.additionalProperties === false) {
            const {additionalProperties, ...rest} = optionsSchema
            return rest
          }
          return optionsSchema
        }),
      },
      getPojoInput: argv => argv.options,
      getArgvLocation: optionLocation,
    },
  }
}

function isNullable(schema: JSONSchema7) {
  if (Array.isArray(schema.type) && schema.type.includes('null')) return true
  if (schema.type === 'null') return true
  if ((schema.anyOf || schema.oneOf)?.some(sub => isNullable(toRoughJsonSchema7(sub)))) return true
  if (schema.const === null) return true
  return false
}

export const tupleItemsSchemas = (schema: JSONSchema7Definition): JSONSchema7Definition[] | undefined => {
  if (!schema || typeof schema !== 'object') return undefined
  if (Array.isArray(schema.items)) return schema.items
  if ('prefixItems' in schema && Array.isArray(schema.prefixItems)) return schema.prefixItems as JSONSchema7Definition[]
  return undefined
}

function isTuple(schema: JSONSchema7): schema is JSONSchema7 & {items: JSONSchema7[]} {
  return Array.isArray(tupleItemsSchemas(schema))
}

function parseArrayInput(array: JSONSchema7 & {items: {type: unknown}}): Result<ParsedProcedure> {
  if (looksLikeJsonSchema(array.items) && isNullable(array.items)) {
    return {
      success: false,
      error: `Invalid input type Array<${getSchemaTypes(array.items).join(' | ')}>. Nullable arrays are not supported.`,
    }
  }
  return {
    success: true,
    value: {
      positionalParameters: [
        {
          name: parameterName(array, 1),
          array: true,
          description: array.description || '',
          required: !isOptional(array),
          type: 'string',
        },
      ],
      optionsJsonSchema: {},
      getPojoInput: argv =>
        (argv.positionalValues.at(-1) as string[]).map(s => coercePositional(array.items as JSONSchema7, s)),
      getArgvLocation: path => ({type: 'positional', index: 0, path}),
    },
  }
}

function parseTupleInput(tuple: JSONSchema7Definition): Result<ParsedProcedure> {
  const items = tupleItemsSchemas(tuple)
  if (!Array.isArray(items)) throw new Error('.items is not an array, is this really a tuple?')

  const flagsSchemaIndex = items.findIndex(item => {
    if (acceptedPrimitiveTypes(item as JSONSchema7).length > 0) {
      return false // it's a string, number or boolean
    }
    if (looksLikeArray(item) && acceptedPrimitiveTypes(item.items as JSONSchema7).length > 0) {
      return false // it's an array of strings, numbers or booleans
    }
    return true // it's not a string, number, boolean or array of strings, numbers or booleans. So it's probably a flags object
  })
  const types = `[${items.map(s => schemaDefPropValue(s, 'type')).join(', ')}]`

  if (flagsSchemaIndex > -1 && flagsSchemaIndex !== items.length - 1) {
    return {
      success: false,
      error: `Invalid input type ${types}. Positional parameters must be strings, numbers or booleans.`,
    }
  }

  const flagsSchema = flagsSchemaIndex === -1 ? null : items[flagsSchemaIndex]

  if (flagsSchema && !acceptsObject(flagsSchema as JSONSchema7)) {
    return {
      success: false,
      error: `Invalid input type ${types}. The last type must accept object inputs.`,
    }
  }

  const positionalSchemas = flagsSchemaIndex === -1 ? items : items.slice(0, flagsSchemaIndex)

  // an optional trailing flags object (`z.tuple([z.string(), z.object({...}).optional()])` - zod encodes tuple
  // optionality via `minItems`) means its properties aren't required at the CLI level, and the handler gets
  // `undefined` rather than `{}` when no flags were passed, matching what a direct call without the argument gets
  const minItems = typeof tuple === 'object' && typeof tuple.minItems === 'number' ? tuple.minItems : items.length
  const flagsOptional = !!flagsSchema && (isOptional(flagsSchema) || flagsSchemaIndex >= minItems)
  const optionsJsonSchema =
    flagsSchema && typeof flagsSchema === 'object' ? (flagsOptional ? {...flagsSchema, required: []} : flagsSchema) : {}

  return {
    success: true,
    value: {
      positionalParameters: positionalSchemas.map((schema, i) => ({
        name: parameterName(schema, i + 1),
        array: looksLikeArray(schema),
        description: schemaDefPropValue(schema, 'description') || '',
        required: !isOptional(schema),
        // `undefined` appears in unions like typebox's `Type.Union([Type.Number(), Type.Undefined()])` for optional
        // tuple elements - it conveys optionality (already shown via `[name]` vs `<name>`), not a real input type
        type: getSchemaTypes(toRoughJsonSchema7(schema))
          .filter(type => type !== 'undefined')
          .join(' | '),
      })),
      optionsJsonSchema,
      getPojoInput: commandArgs => {
        const inputs: unknown[] = commandArgs.positionalValues.map((v, i) => {
          const correspondingSchema = positionalSchemas[i]
          if (looksLikeArray(correspondingSchema)) {
            if (!Array.isArray(v)) {
              throw new CliValidationError(`Expected array at position ${i}, got ${typeof v}`)
            }
            return v.map(s => {
              if (!correspondingSchema.items || Array.isArray(correspondingSchema.items)) return s
              return coercePositional(correspondingSchema.items, s)
            })
          }
          if (typeof v !== 'string' && v !== undefined) {
            throw new CliValidationError(`Expected string at position ${i}, got ${typeof v}`)
          }
          return coercePositional(correspondingSchema, v)
        })

        if (flagsSchema && !(flagsOptional && Object.keys(commandArgs.options).length === 0)) {
          inputs.push(commandArgs.options)
        }
        return inputs
      },
      getArgvLocation: ([index, ...rest]) => {
        if (typeof index !== 'number') return undefined
        if (index < positionalSchemas.length) return {type: 'positional', index, path: rest}
        if (flagsSchema && index === flagsSchemaIndex) return optionLocation(rest)
        return undefined
      },
    },
  }
}

/** `getArgvLocation` for inputs that are plain objects: the first path segment is the option's property key */
const optionLocation = (path: PropertyKey[]): ArgvLocation | undefined => {
  const [key, ...rest] = path
  return typeof key === 'string' ? {type: 'option', key, path: rest} : undefined
}

const primitiveTypes = new Set(['string', 'number', 'integer', 'boolean'])

/**
 * Converts a CLI string (positional or option value) into the type the schema accepts, where there's a sensible
 * conversion. Anything else is passed through as typed, for the schema to reject with its own message against the
 * argument/option it came from. The one exception is malformed JSON when only JSON could produce an accepted value:
 * passing `{"a": 1,}` through would degrade "Malformed JSON" into "expected object, received string".
 */
export const coerce = (schema: JSONSchema7Definition, value: string): unknown => {
  const types = new Set(getSchemaTypes(toRoughJsonSchema7(schema)))
  types.delete('undefined') // e.g. typebox's `Type.Union([Type.Number(), Type.Undefined()])` for optional tuple elements

  if (types.has('boolean') && (value === 'true' || value === 'false')) return value === 'true'

  const number = value.trim() ? Number(value) : Number.NaN // `Number('')` is 0, which is never what someone meant
  if (!Number.isNaN(number)) {
    if (types.has('number')) return number
    // a non-integer for an integer-only schema stays a number, so the schema says "expected int" rather than "expected number, received string"
    if (types.has('integer') && (Number.isInteger(number) || !types.has('string'))) return number
  }

  if (types.size === 0 || [...types].some(t => !primitiveTypes.has(t))) {
    try {
      const parsed = JSON.parse(value) as unknown
      const parsedType = Array.isArray(parsed) ? 'array' : parsed === null ? 'null' : typeof parsed
      // strings win over JSON of the wrong type, e.g. `123` for `string | null` stays the string "123"
      if (types.size === 0 || types.has(parsedType) || !types.has('string')) return parsed
    } catch {
      if (types.size === 0) {
        throw new InvalidArgumentError(
          `Malformed JSON. If passing a string, pass it as a valid JSON string with quotes (${JSON.stringify(value)})`,
        )
      }
      if (!types.has('string') && (types.has('object') || types.has('array'))) {
        throw new InvalidArgumentError(`Malformed JSON.`)
      }
    }
  }

  return value
}

/**
 * Positionals are coerced after commander has parsed argv, where a throw wouldn't be reported against the argument.
 * So malformed JSON is passed through as typed instead, for the schema to reject.
 */
const coercePositional = (schema: JSONSchema7Definition, value: string | undefined): unknown => {
  if (value === undefined) return value // an optional positional that wasn't passed
  try {
    return coerce(schema, value)
  } catch (error) {
    if (error instanceof InvalidArgumentError) return value
    throw error
  }
}

const looksLikeArray = (schema: JSONSchema7Definition): schema is JSONSchema7 & {type: 'array'} => {
  return schemaDefPropValue(schema, 'type') === 'array'
}

const toRoughJsonSchema7 = (schema: JSONSchema7Definition | undefined): JSONSchema7 => {
  if (!schema || typeof schema !== 'object') {
    return {}
  }

  return schema
}

const maybeParameterName = (s: JSONSchema7Definition): string | undefined => {
  const value = schemaDefPropValue(s, 'title') || schemaDefPropValue(s, 'description')
  // only look at array item title if we don't have one for the outer array itself
  // e.g. for {title: 'file collection', items: {title: 'file'}} we prefer 'file collection' as the parameter name
  if (!value && looksLikeArray(s)) {
    const items = toRoughJsonSchema7(s).items
    return items && !Array.isArray(items) ? maybeParameterName(items) : undefined
  }
  return value
}

const parameterName = (s: JSONSchema7Definition, position: number): string => {
  let name = maybeParameterName(s) || `parameter_${position}`
  if (looksLikeArray(s)) return `[${name}...]`

  // commander requiremenets: no special characters in positional parameters; `<name>` for required and `[name]` for optional parameters
  // dashes are allowed though, so kebab-case names (e.g. from module-commands parameter names) display as `<the-number>`
  name = name.replaceAll(/[^\w-]+/g, ' ').trim()
  return isOptional(s) ? `[${name}]` : `<${name}>`
}

const acceptsObject = (schema: JSONSchema7): boolean => {
  return (schema.type === 'object' || schema.anyOf?.some(sub => acceptsObject(toRoughJsonSchema7(sub)))) ?? false
}
