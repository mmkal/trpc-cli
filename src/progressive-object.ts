/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-explicit-any */
import {JSONSchema7} from 'json-schema'
import {toJsonSchema} from './json-schema.js'
import {isOptional} from './parse-procedure.js'
import {StandardSchemaV1} from './standard-schema/contract.js'

export type ProgressiveProp = {
  propName: string
  propType: StandardSchemaV1<any>
  modifier?: (baseType: StandardSchemaV1<any>, soFar: any) => StandardSchemaV1<any>
}

const progressiveObjectSchema = <Shape extends Record<string, StandardSchemaV1<any>>>(
  props: ProgressiveProp[],
): ProgressiveObjectSchema<Shape> => {
  const schema: StandardSchemaV1<Shape> = {
    '~standard': {
      version: 1,
      vendor: 'progressive-object-schema',
      validate: async _input => {
        const input = _input as Record<string, unknown>
        let obj: Record<string, unknown> = {}
        for (const {propName, propType, modifier} of props) {
          const type = modifier ? modifier(propType, obj) : propType
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
    __progressiveProps: props,
    toJsonSchema: () => {
      const propertyEntries = props.map(({propName, propType: baseType, modifier}) => {
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
        let propType = baseType
        if (modifier) {
          propType = modifier(propType, propChecker)
        }
        // const propType = typeof propTypeOrFn === 'function' ? propTypeOrFn(propChecker) : propTypeOrFn
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
      const required = propertyEntries.flatMap(([name, sch]) => {
        if (isOptional(sch as {})) return []
        return [name as string]
      })
      return {
        type: 'object',
        required,
        properties: Object.fromEntries(propertyEntries),
      } satisfies JSONSchema7
    },
    prop: (...args: unknown[]) => {
      const [name, type, modifier] = args as [string, ProgressiveProp['propType'], ProgressiveProp['modifier']]
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
      return progressiveObjectSchema([
        ...props,
        {propName: name, propType: type, modifier},
      ]) as ProgressiveObjectSchema<never>
    },
  }
}

export const obj = progressiveObjectSchema<{}>([])

export type ProgressiveObjectSchema<T extends Record<string, StandardSchemaV1<any>>> = StandardSchemaV1<T> & {
  __progressiveProps: ProgressiveProp[]
  toJsonSchema: () => JSONSchema7
  prop<Name extends string, Type extends StandardSchemaV1<any>>(
    name: Name,
    type: Type,
  ): ProgressiveObjectSchema<T & Record<Name, Type>>
  prop<Name extends string, BaseType extends StandardSchemaV1<any>, Type extends StandardSchemaV1<any>>(
    name: Name,
    type: BaseType,
    modifier?: (
      type: NoInfer<BaseType>,
      soFar: Record<string, never> | {[K in keyof T]: NonNullable<T[K]['~standard']['types']>['output']},
    ) => Type,
  ): ProgressiveObjectSchema<T & Record<Name, Type>>
}

/** Check if a value is a ProgressiveObjectSchema */
export function isProgressiveObjectSchema(value: unknown): value is ProgressiveObjectSchema<any> {
  return (
    typeof value === 'object' &&
    value !== null &&
    '__progressiveProps' in value &&
    Array.isArray((value as ProgressiveObjectSchema<any>).__progressiveProps)
  )
}
