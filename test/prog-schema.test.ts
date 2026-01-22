import {expect, expectTypeOf, test} from 'vitest'
import {obj} from '../src/progressive-object.js'
import {prettifyStandardSchemaError} from '../src/standard-schema/errors.js'

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

test('json schema', async () => {
  const {z} = await import('zod')
  const Person = obj
    .prop('name', z.string()) //
    .prop('age', z.number())

  const Config = obj
    .prop('framework', z.enum(['react', 'vue'])) //
    .prop('typescript', props => z.boolean().default(props.framework === 'react'))

  expect(Person.toJsonSchema()).toMatchInlineSnapshot(`
    {
      "properties": {
        "age": {
          "$schema": "https://json-schema.org/draft/2020-12/schema",
          "type": "number",
        },
        "name": {
          "$schema": "https://json-schema.org/draft/2020-12/schema",
          "type": "string",
        },
      },
      "type": "object",
    }
  `)

  expect(Config.toJsonSchema()).toMatchInlineSnapshot(`
    {
      "properties": {
        "framework": {
          "$schema": "https://json-schema.org/draft/2020-12/schema",
          "enum": [
            "react",
            "vue",
          ],
          "type": "string",
        },
        "typescript": {
          "$comment": "Note: this schema may differ at runtime based on the value of \`framework\`",
          "$schema": "https://json-schema.org/draft/2020-12/schema",
          "default": false,
          "type": "boolean",
        },
      },
      "type": "object",
    }
  `)
})
