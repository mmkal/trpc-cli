import {expect, expectTypeOf, test} from 'vitest'
import {z} from 'zod'
import {StandardSchemaV1} from '../../src/standard-schema/contract.js'

const getProgZod = <Shape extends Record<string, z.ZodType<any, any, any>>>(
  props: Array<{
    propName: string
    propType: z.ZodType<any, any, any> | ((soFar: any) => z.ZodType<any, any, any> | Promise<z.ZodType<any, any, any>>)
  }>,
): ProgZod<Shape> => {
  const ss: StandardSchemaV1<Shape> = {
    '~standard': {
      version: 1,
      vendor: 'prog-zod',
      validate: async _input => {
        const input = _input as Record<string, unknown>
        let obj: Record<string, unknown> = {}
        for (const {propName, propType} of props) {
          const type = typeof propType === 'function' ? await propType(obj) : propType
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
    ...ss,
    prop: (name, type) => getProgZod([...props, {propName: name, propType: type}]),
  }
}

export const progZod = getProgZod<{}>([])

type ProgZod<T extends Record<string, z.ZodType<any, any, any>>> = StandardSchemaV1<T> & {
  prop: <Name extends string, Type extends z.ZodType<any, any, any>>(
    name: Name,
    type: Type | ((soFar: z.infer<z.ZodObject<T>>) => Type | Promise<Type>),
  ) => ProgZod<T & Record<Name, Type>>
}

test('progZod', async () => {
  const Person = progZod
    .prop('name', z.string()) //
    .prop('age', z.number())

  const Config = progZod.prop('framework', z.enum(['react', 'vue'])).prop('typescript', props => {
    expectTypeOf(props).toEqualTypeOf<{framework: 'react' | 'vue'}>()
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

  expect(await Person['~standard'].validate({name: 'John', ageTYPO: 30})).toMatchInlineSnapshot(`
    {
      "issues": [
        {
          "code": "invalid_type",
          "expected": "number",
          "message": "Invalid input: expected number, received undefined",
          "path": [
            "age",
          ],
        },
      ],
    }
  `)
  expect(await Config['~standard'].validate({framework: 'react', typescriptTYPO: true})).toMatchInlineSnapshot(`
    {
      "value": {
        "framework": "react",
        "typescript": true,
      },
    }
  `)
})
