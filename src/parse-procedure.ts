import type {JSONSchema7, JSONSchema7Definition} from 'json-schema'
import {inspect} from 'util'
import zodToJsonSchema from 'zod-to-json-schema'
import {CliValidationError} from './errors'
import {getSchemaTypes} from './json-schema'
import type {Dependencies, ParsedProcedure, Result} from './types'

/**
 * Attempts to convert a trpc procedure input to JSON schema.
 * Uses @see jsonSchemaConverters to convert the input to JSON schema.
 */
function toJsonSchema(input: unknown, dependencies: Dependencies): Result<JSONSchema7> {
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

export function parseProcedureInputs(inputs: unknown[], dependencies: Dependencies): Result<ParsedProcedure> {
  if (inputs.length === 0) {
    return {
      success: true,
      value: {
        positionalParameters: [],
        optionsJsonSchema: {},
        getPojoInput: () => ({}),
      },
    }
  }

  const allJsonSchemaable = inputs.every(input => looksJsonSchemaable(input))
  if (!allJsonSchemaable) {
    return {
      success: false,
      error: `Invalid input type ${inputs.map(s => (s as {})?.constructor.name).join(', ')}, only inputs that can be converted to JSON Schema are supported`,
    }
  }

  if (inputs.length > 1) {
    return parseMultiInputs(inputs, dependencies)
  }

  const mergedSchemaResult = toJsonSchema(inputs[0], dependencies)

  if (!mergedSchemaResult.success) {
    return {
      success: false,
      error: mergedSchemaResult.error,
    }
  }

  const mergedSchema = mergedSchemaResult.value
  return handleMergedSchema(mergedSchema)
}

function handleMergedSchema(mergedSchema: JSONSchema7): Result<ParsedProcedure> {
  if (mergedSchema.additionalProperties) {
    return {success: false, error: `Inputs with additional properties are not currently supported`}
  }

  if (mergedSchema.type === 'string') {
    return {
      success: true,
      value: {
        positionalParameters: [
          {
            type: 'string',
            array: false,
            description: mergedSchema.description || '',
            name: mergedSchema.title || 'string',
            required: !isOptional(mergedSchema),
          },
        ],
        optionsJsonSchema: {},
        getPojoInput: argv => argv.positionalValues[0] as string,
      },
    }
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
  if ((schema as {$zod?: {optional?: boolean}}).$zod?.optional) return true
  if ((schema as {$valibot?: {optional?: boolean}}).$valibot?.optional) return true
  const anyOf = schemaDefPropValue(schema, 'anyOf')
  return anyOf?.length === 2 && JSON.stringify(anyOf[0]) === '{"not":{}}'
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

function parseMultiInputs(inputs: unknown[], dependencies: Dependencies): Result<ParsedProcedure> {
  const parsedIndividually = inputs.map(input => parseProcedureInputs([input], dependencies))

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

  return {
    success: true,
    value: {
      positionalParameters: [],
      optionsJsonSchema: {
        allOf: parsedIndividually.map(p => {
          const successful = p as Extract<typeof p, {success: true}>
          return successful.value.optionsJsonSchema
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
          if (typeof v !== 'string') {
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

const parameterName = (s: JSONSchema7Definition, position: number): string => {
  if (looksLikeArray(s)) {
    const items = toRoughJsonSchema7(s).items
    const elementName = parameterName(!items || Array.isArray(items) ? {} : items, position)
    return `[${elementName.slice(1, -1)}...]`
  }
  // commander requiremenets: no special characters in positional parameters; `<name>` for required and `[name]` for optional parameters
  let name = schemaDefPropValue(s, 'title') || schemaDefPropValue(s, 'description') || `parameter_${position}`
  name = name.replaceAll(/\W+/g, ' ').trim()
  return isOptional(s) ? `[${name}]` : `<${name}>`
}

const acceptsObject = (schema: JSONSchema7): boolean => {
  return (schema.type === 'object' || schema.anyOf?.some(sub => acceptsObject(toRoughJsonSchema7(sub)))) ?? false
}

// #region vendor specific stuff

/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-require-imports */

/** `Record<standard-schema vendor id, function that converts the input to JSON schema>` */
const getJsonSchemaConverters = (dependencies: Dependencies) => {
  return {
    zod: (input: unknown) => {
      if (dependencies.zod?.toJSONSchema) {
        const toJSONSchema = dependencies.zod.toJSONSchema as typeof import('zod4').toJSONSchema
        // zod4 has toJSONSchema built in.
        const converted = toJSONSchema(input as never, {
          // todo[zod@>=4.0.0] remove the line if https://github.com/colinhacks/zod/issues/4167 is resolved, or this comment if it's closed
          pipes: 'input',
          // todo[zod@>=4.0.0] remove the override if https://github.com/colinhacks/zod/issues/4164 is resolved, or this comment if it's closed
          override: ctx => {
            if (ctx.zodSchema?.constructor?.name === 'ZodOptional') {
              ctx.jsonSchema.$zod = {optional: true}
            }
          },
          unrepresentable: 'any',
        })

        return converted as JSONSchema7
      }
      return zodToJsonSchema(input as never) as JSONSchema7
    },
    arktype: (input: unknown) => {
      const _fn = () => (({}) as typeof import('arktype').type)('string')
      const type = prepareArktypeType(input) as ReturnType<typeof _fn>
      return type.toJsonSchema({
        fallback: ctx => {
          return ctx.base
        },
      }) as JSONSchema7
    },
    valibot: (input: unknown) => {
      let valibotToJsonSchemaLib = dependencies['@valibot/to-json-schema']
      if (!valibotToJsonSchemaLib) {
        try {
          valibotToJsonSchemaLib = eval(`require('@valibot/to-json-schema')`)
        } catch (e: unknown) {
          throw new Error(`@valibot/to-json-schema could not be found - try installing it and re-running`, {cause: e})
        }
      }

      const valibotToJsonSchema = valibotToJsonSchemaLib?.toJsonSchema
      if (!valibotToJsonSchema) {
        throw new Error(
          `no 'toJsonSchema' function found in @valibot/to-json-schema - check you are using a supported version`,
        )
      }
      let v: any
      try {
        v = eval(`require('valibot')`)
      } catch {
        // couldn't load valibot, maybe it's aliased to something else? anyway bad luck, you won't know about optional positional parameters, but that's a rare-ish case so not a big deal
      }
      if (v) {
        const parent = valibotToJsonSchema(v.object({child: input}), {errorMode: 'ignore'})
        const child = parent.properties!.child as JSONSchema7
        return parent.required?.length === 0 ? Object.assign(child, {$valibot: {optional: true}}) : child
      }
      return valibotToJsonSchema(input)
    },
    effect: (input: unknown) => {
      const effect = dependencies.effect || (eval(`require('effect')`) as Dependencies['effect'])
      if (!effect) {
        throw new Error(`effect dependency could not be found - try installing it and re-running`)
      }
      if (!effect.Schema.isSchema(input)) {
        const message = `input was not an effect schema - please use effect version 3.14.2 or higher. See https://github.com/mmkal/trpc-cli/pull/63`
        throw new Error(message)
      }
      return effect.JSONSchema.make(input)
    },
  } satisfies Record<string, (input: unknown) => JSONSchema7>
}

function getVendor(schema: unknown) {
  // note: don't check for typeof schema === 'object' because arktype schemas are functions (you call them directly instead of `.parse(...)`)
  return (schema as {['~standard']?: {vendor?: string}})?.['~standard']?.vendor ?? null
}

const jsonSchemaVendorNames = new Set(Object.keys(getJsonSchemaConverters({})))
function looksJsonSchemaable(value: unknown) {
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
