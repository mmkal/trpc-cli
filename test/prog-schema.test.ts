import {expect, expectTypeOf, test} from 'vitest'
import {StandardSchemaV1} from '../src/standard-schema/contract.js'
import {prettifyStandardSchemaError} from '../src/standard-schema/errors.js'

const progressiveObjectSchema = <Shape extends Record<string, StandardSchemaV1<any>>>(
  props: Array<{
    propName: string
    propType: StandardSchemaV1<any> | ((soFar: any) => StandardSchemaV1<any>)
  }>,
): ProgSchema<Shape> => {
  const schema: StandardSchemaV1<Shape> = {
    '~standard': {
      version: 1,
      vendor: 'prog-schema',
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
    prop: (name, type) => progressiveObjectSchema([...props, {propName: name, propType: type}]),
  }
}

export const obj = progressiveObjectSchema<{}>([])

type ProgSchema<T extends Record<string, StandardSchemaV1<any>>> = StandardSchemaV1<T> & {
  prop: <Name extends string, Type extends StandardSchemaV1<any>>(
    name: Name,
    type:
      | Type
      | ((soFar: Record<string, never> | {[K in keyof T]: NonNullable<T[K]['~standard']['types']>['output']}) => Type),
  ) => ProgSchema<T & Record<Name, Type>>
}

test('progSchema', async () => {
  const {z} = await import('zod')
  const Person = obj
    .prop('name', z.string()) //
    .prop('age', z.number())

  const Config = obj
    .prop('framework', z.enum(['react', 'vue'])) //
    .prop('typescript', props => z.boolean().default(props.framework === 'react'))

  expect(await Person['~standard'].validate({name: 'John', age: 30})).toEqual({
    value: {name: 'John', age: 30},
  })
  expect(await Config['~standard'].validate({framework: 'react', typescript: true})).toEqual({
    value: {framework: 'react', typescript: true},
  })

  expect(await Config['~standard'].validate({framework: 'react'})).toEqual({
    value: {framework: 'react', typescript: true},
  })
  expect(await Config['~standard'].validate({framework: 'vue'})).toEqual({
    value: {framework: 'vue', typescript: false},
  })

  expect(
    prettifyStandardSchemaError(await Person['~standard'].validate({name: 'John', ageTYPO: 30})),
  ).toMatchInlineSnapshot(`"✖ Invalid input: expected number, received undefined → at age"`)
  expect(await Config['~standard'].validate({framework: 'react', typescriptTYPO: true})).toMatchInlineSnapshot(`
    {
      "value": {
        "framework": "react",
        "typescript": true,
      },
    }
  `)
})

test('progSchema with mixded libraries', async () => {
  const {z} = await import('zod')
  const v = await import('valibot')
  const Person = obj
    .prop('name', z.string()) //
    .prop('age', v.number())

  const Config = obj.prop('framework', z.enum(['react', 'vue'])).prop('typescript', props => {
    expectTypeOf(props).toEqualTypeOf<Record<string, never> | {framework: 'react' | 'vue'}>()
    return z.boolean().default(props.framework === 'react')
  })

  expect(await Person['~standard'].validate({name: 'John', age: 30})).toEqual({
    value: {name: 'John', age: 30},
  })
  expect(await Config['~standard'].validate({framework: 'react', typescript: true})).toEqual({
    value: {framework: 'react', typescript: true},
  })

  expect(await Config['~standard'].validate({framework: 'react'})).toEqual({
    value: {framework: 'react', typescript: true},
  })
  expect(await Config['~standard'].validate({framework: 'vue'})).toEqual({
    value: {framework: 'vue', typescript: false},
  })
  expect(
    prettifyStandardSchemaError(await Person['~standard'].validate({name: 'John', ageTYPO: 30})),
  ).toMatchInlineSnapshot(`"✖ Invalid type: Expected number but received undefined → at age"`)
  expect(
    prettifyStandardSchemaError(await Person['~standard'].validate({nameTYPO: 'John', ageTYPO: 30})),
  ).toMatchInlineSnapshot(`"✖ Invalid input: expected string, received undefined → at name"`)
  expect(await Config['~standard'].validate({framework: 'react', typescriptTYPO: true})).toMatchInlineSnapshot(`
    {
      "value": {
        "framework": "react",
        "typescript": true,
      },
    }
  `)
})
