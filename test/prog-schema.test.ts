import * as trpcServer from '@trpc/server'
import {expect, expectTypeOf, test, vi} from 'vitest'
import {createCli, type TrpcCliMeta} from '../src/index.js'
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
      "required": [
        "name",
        "age",
      ],
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
          "$schema": "https://json-schema.org/draft/2020-12/schema",
          "default": false,
          "description": "Note: this schema may differ at runtime based on the value of \`framework\`",
          "type": "boolean",
        },
      },
      "required": [
        "framework",
      ],
      "type": "object",
    }
  `)
})

test('progressive prompting with dynamic defaults', async () => {
  const {z} = await import('zod/v4')

  const trpc = trpcServer.initTRPC.meta<TrpcCliMeta>().create()

  const router = trpc.router({
    createApp: trpc.procedure
      .input(
        obj
          .prop('framework', z.enum(['react', 'vue']))
          .prop('rpcLibrary', inputs =>
            z.enum(['trpc', 'orpc']).default(inputs.framework === 'react' ? 'trpc' : 'orpc'),
          )
          .prop('typescript', inputs => z.boolean().default(inputs.framework === 'react')),
      )
      .query(({input}) => JSON.stringify(input)),
  })

  const selectCalls: Array<{message: string; choices: string[]; default?: string}> = []
  const confirmCalls: Array<{message: string; default?: boolean}> = []

  const cli = createCli({router})
  const logs: unknown[][] = []
  const addLogs = (...args: unknown[]) => logs.push(args)

  const result = await cli
    .run({
      logger: {info: addLogs, error: addLogs},
      process: {exit: () => 0 as never},
      argv: ['create-app'], // no args provided, will prompt for everything
      prompts: () => ({
        select: async params => {
          selectCalls.push({message: params.message, choices: params.choices as string[], default: params.default})
          // Simulate user choosing vue for framework (match on --framework specifically)
          if (params.message.startsWith('--framework')) return 'vue'
          // For other selects, use the default or first choice
          return params.default ?? (params.choices as string[])[0]
        },
        confirm: async params => {
          confirmCalls.push({message: params.message, default: params.default})
          return params.default ?? false
        },
        input: async params => params.default ?? '',
        checkbox: async params => params.choices.map(c => c.value),
      }),
    })
    .catch(e => {
      if (e.exitCode === 0) return e.cause
      throw e
    })

  // Verify that the rpcLibrary prompt got the correct default based on framework='vue'
  const rpcLibraryCall = selectCalls.find(c => c.message.includes('rpc-library'))
  expect(rpcLibraryCall?.default).toBe('orpc') // vue -> orpc

  // Verify that the typescript prompt got the correct default based on framework='vue'
  const typescriptCall = confirmCalls.find(c => c.message.includes('typescript'))
  expect(typescriptCall?.default).toBe(false) // vue -> false

  // The final result should have the correct values
  expect(JSON.parse(result as string)).toEqual({
    framework: 'vue',
    rpcLibrary: 'orpc',
    typescript: false,
  })
})

test('progressive prompting when user selects react', async () => {
  const {z} = await import('zod/v4')

  const trpc = trpcServer.initTRPC.meta<TrpcCliMeta>().create()

  const router = trpc.router({
    createApp: trpc.procedure
      .input(
        obj
          .prop('framework', z.enum(['react', 'vue']))
          .prop('rpcLibrary', inputs =>
            z.enum(['trpc', 'orpc']).default(inputs.framework === 'react' ? 'trpc' : 'orpc'),
          )
          .prop('typescript', inputs => z.boolean().default(inputs.framework === 'react')),
      )
      .query(({input}) => JSON.stringify(input)),
  })

  const selectCalls: Array<{message: string; choices: string[]; default?: string}> = []
  const confirmCalls: Array<{message: string; default?: boolean}> = []

  const cli = createCli({router})
  const logs: unknown[][] = []
  const addLogs = (...args: unknown[]) => logs.push(args)

  const result = await cli
    .run({
      logger: {info: addLogs, error: addLogs},
      process: {exit: () => 0 as never},
      argv: ['create-app'], // no args provided, will prompt for everything
      prompts: () => ({
        select: async params => {
          selectCalls.push({message: params.message, choices: params.choices as string[], default: params.default})
          // Simulate user choosing react for framework (match on --framework specifically)
          if (params.message.startsWith('--framework')) {
            return 'react'
          }
          // For other selects, use the default or first choice
          const selected = params.default ?? (params.choices as string[])[0]
          return selected
        },
        confirm: async params => {
          confirmCalls.push({message: params.message, default: params.default})
          return params.default ?? false
        },
        input: async params => params.default ?? '',
        checkbox: async params => params.choices.map(c => c.value),
      }),
    })
    .catch(e => {
      if (e.exitCode === 0) return e.cause
      throw e
    })

  // Verify that the rpcLibrary prompt got the correct default based on framework='react'
  const rpcLibraryCall = selectCalls.find(c => c.message.includes('rpc-library'))
  expect(rpcLibraryCall?.default).toBe('trpc') // react -> trpc

  // Verify that the typescript prompt got the correct default based on framework='react'
  const typescriptCall = confirmCalls.find(c => c.message.includes('typescript'))
  expect(typescriptCall?.default).toBe(true) // react -> true

  // The final result should have the correct values
  expect(JSON.parse(result as string)).toEqual({
    framework: 'react',
    rpcLibrary: 'trpc',
    typescript: true,
  })
})
