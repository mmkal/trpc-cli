/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-explicit-any */
import {JSONSchema7} from 'json-schema'
import {isOptional, toJsonSchema} from './parse-procedure.js'
import {StandardSchemaV1} from './standard-schema/contract.js'

const progressiveObjectSchema = <Shape extends Record<string, StandardSchemaV1<any>>>(
  props: Array<{
    propName: string
    propType: StandardSchemaV1<any> | ((soFar: any) => StandardSchemaV1<any>)
  }>,
): ProgressiveObjectSchema<Shape> => {
  const schema: StandardSchemaV1<Shape> = {
    '~standard': {
      version: 1,
      vendor: 'progressive-object-schema',
      validate: async _input => {
        const input = _input as Record<string, unknown>
        let obj: Record<string, unknown> = {}
        for (const {propName, propType} of props) {
          const type = typeof propType === 'function' ? propType(obj) : propType
          const parsed = await type['~standard'].validate(input[propName])
          if ('issues' in parsed) {
            return {
              issues: parsed.issues?.map(iss => ({...iss, path: [propName, ...(iss.path || [])]})),
            } as StandardSchemaV1.FailureResult
          }
          obj = {...obj, [propName]: parsed.value!}
        }
        return {value: obj} as StandardSchemaV1.SuccessResult<Shape>
      },
    },
  }
  return {
    ...schema,
    toJsonSchema: () => {
      const propertyEntries = props.map(({propName, propType: propTypeOrFn}) => {
        const usedProps: string[] = []
        const propChecker = new Proxy(
          {},
          {
            get: (_target, prop) => {
              usedProps.push(prop as string)
              return undefined
            },
          },
        )
        const propType = typeof propTypeOrFn === 'function' ? propTypeOrFn(propChecker) : propTypeOrFn
        // todo: use standard-json-schema
        const propSchema = toJsonSchema(propType, {})
        if (!propSchema.success) {
          throw new Error(`Failed to convert property ${propName} to JSON schema: ${propSchema.error}`)
        }
        if (usedProps.length) {
          const message = `Note: this schema may differ at runtime based on the value of ${usedProps.map(p => `\`${p}\``).join(', ')}`
          propSchema.value.description = [propSchema.value.description, message].filter(Boolean).join('\n')
        }
        return [propName, propSchema.value]
      })
      const required = propertyEntries.flatMap(([name, schema]) => {
        if (isOptional(schema as {})) return []
        return [name]
      })
      return {
        type: 'object',
        required,
        properties: Object.fromEntries(propertyEntries),
      }
    },
    prop: (name, type) => progressiveObjectSchema([...props, {propName: name, propType: type}]),
  }
}

export const obj = progressiveObjectSchema<{}>([])

export type ProgressiveObjectSchema<T extends Record<string, StandardSchemaV1<any>>> = StandardSchemaV1<T> & {
  toJsonSchema: () => JSONSchema7
  prop: <Name extends string, Type extends StandardSchemaV1<any>>(
    name: Name,
    type:
      | Type
      | ((soFar: Record<string, never> | {[K in keyof T]: NonNullable<T[K]['~standard']['types']>['output']}) => Type),
  ) => ProgressiveObjectSchema<T & Record<Name, Type>>
}
