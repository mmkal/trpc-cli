import type {JSONSchema7, JSONSchema7Definition} from 'json-schema'
import {inspect} from 'util'
import {CliValidationError} from './errors.js'
import {getSchemaTypes, looksJsonSchemaable, toJsonSchema} from './json-schema.js'
import type {Dependencies, ParsedProcedure, Result} from './types.js'

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
                options[key] = convertPositional(schema, positionalValues.shift() as string)
              }

              return inner.value.getPojoInput({positionalValues, options})
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
    const allObjects = mergedSchema.anyOf.every(sub => acceptsObject(toRoughJsonSchema7(sub)))
    if (allObjects) {
      return {
        success: true,
        value: {
          positionalParameters: [],
          optionsJsonSchema: mergedSchema,
          getPojoInput: argv => argv.options,
        },
      }
    }
    if (mergedSchema.anyOf.length === 2 && JSON.stringify(mergedSchema.anyOf[0]) === '{"not":{}}') {
      return handleMergedSchema(mergedSchema.anyOf[1] as JSONSchema7)
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
    },
  }
}

// zod-to-json-schema turns `z.string().optional()` into `{"anyOf":[{"not":{}},{"type":"string"}]}`
function isOptional(schema: JSONSchema7Definition) {
  if (schema && typeof schema === 'object' && 'optional' in schema) return schema.optional === true
  if (schemaDefPropValue(schema, 'not') && JSON.stringify(schema) === '{"not":{}}') return true
  const anyOf = schemaDefPropValue(schema, 'anyOf')
  if (anyOf?.some(sub => isOptional(sub))) return true
  if (schemaDefPropValue(schema, 'default') !== undefined) return true
  return false
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
      getPojoInput: argv => convertPositional(schema, argv.positionalValues[0] as string),
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

const tupleItemsSchemas = (schema: JSONSchema7Definition): JSONSchema7Definition[] | undefined => {
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
        (argv.positionalValues.at(-1) as string[]).map(s => convertPositional(array.items as JSONSchema7, s)),
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

  return {
    success: true,
    value: {
      positionalParameters: positionalSchemas.map((schema, i) => ({
        name: parameterName(schema, i + 1),
        array: looksLikeArray(schema),
        description: schemaDefPropValue(schema, 'description') || '',
        required: !isOptional(schema),
        type: getSchemaTypes(toRoughJsonSchema7(schema)).join(' | '),
      })),
      optionsJsonSchema: flagsSchema && typeof flagsSchema === 'object' ? flagsSchema : {},
      getPojoInput: commandArgs => {
        const inputs: unknown[] = commandArgs.positionalValues.map((v, i) => {
          const correspondingSchema = positionalSchemas[i]
          if (looksLikeArray(correspondingSchema)) {
            if (!Array.isArray(v)) {
              throw new CliValidationError(`Expected array at position ${i}, got ${typeof v}`)
            }
            return v.map(s => {
              if (!correspondingSchema.items || Array.isArray(correspondingSchema.items)) return s
              return convertPositional(correspondingSchema.items, s)
            })
          }
          if (typeof v !== 'string' && v !== undefined) {
            throw new CliValidationError(`Expected string at position ${i}, got ${typeof v}`)
          }
          return convertPositional(correspondingSchema, v)
        })

        if (flagsSchema) {
          inputs.push(commandArgs.options)
        }
        return inputs
      },
    },
  }
}

/**
 * Converts a positional string to parameter into a number if the target schema accepts numbers, and the input can be parsed as a number.
 * If the target schema accepts numbers but it's *not* a valid number, just return a string.
 * trpc will use zod to handle the validation before invoking the procedure.
 */
const convertPositional = (schema: JSONSchema7Definition, value: string) => {
  let preprocessed: string | number | boolean | undefined = undefined

  const acceptedTypes = new Set(acceptedPrimitiveTypes(schema))

  if (acceptedTypes.has('string')) {
    preprocessed = value
  }

  if (acceptedTypes.has('boolean')) {
    if (value === 'true') preprocessed = true
    else if (value === 'false') preprocessed = false
  }

  if (acceptedTypes.has('number')) {
    const number = Number(value)
    if (!Number.isNaN(number)) {
      preprocessed = number
    }
  }

  if (acceptedTypes.has('integer')) {
    const num = Number(value)
    if (Number.isInteger(num)) {
      preprocessed = num
    } else if (!Number.isNaN(num) && acceptedTypes === undefined) {
      // we're expecting an integer and the value isn't one, but we haven't come up with anything else, so use it anyway to get helpful "expected integer, got float" error rather than "expected number, got string"
      preprocessed = value
    }
  }

  if (preprocessed === undefined) {
    return value // we didn't convert to a number or boolean, so just return the string
  }

  return preprocessed
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
  name = name.replaceAll(/\W+/g, ' ').trim()
  return isOptional(s) ? `[${name}]` : `<${name}>`
}

const acceptsObject = (schema: JSONSchema7): boolean => {
  return (schema.type === 'object' || schema.anyOf?.some(sub => acceptsObject(toRoughJsonSchema7(sub)))) ?? false
}
