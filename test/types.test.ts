/* eslint-disable @typescript-eslint/unbound-method */
import {test, expectTypeOf} from 'vitest'
import {z} from 'zod/v4'
import {EnquirerLike, InquirerPromptsLike, isAgent, Promptable} from '../src/index.js'
import type {AnyRouter, TrpcCliMeta, TrpcCliParams, TrpcCliRunParams} from '../src/index.js'

test('prompt types', async () => {
  expectTypeOf<typeof import('@inquirer/prompts')>().toExtend<InquirerPromptsLike>()
  expectTypeOf<typeof import('enquirer')>().toExtend<EnquirerLike>()

  expectTypeOf<typeof import('@inquirer/prompts')>().toExtend<Promptable>()
  expectTypeOf<typeof import('enquirer')>().toExtend<Promptable>()
})

test('agent-aware prompt disabling type', async () => {
  expectTypeOf({prompts: isAgent({}) ? null : ({} as Promptable)}).toMatchTypeOf<TrpcCliRunParams>()
  expectTypeOf({prompts: !isAgent({})}).toMatchTypeOf<TrpcCliRunParams>()
})

test('jsonInput createCli param type', async () => {
  expectTypeOf<TrpcCliParams<AnyRouter>>()
    .toHaveProperty('jsonInput')
    .toEqualTypeOf<'never' | 'auto' | 'always' | undefined>()
  expectTypeOf<TrpcCliMeta>().toHaveProperty('jsonInput').toEqualTypeOf<'never' | 'auto' | 'always' | undefined>()
})

test('zod meta', async () => {
  expectTypeOf(z.string())
    .toHaveProperty('meta')
    .parameter(0)
    .exclude<undefined>()
    .toHaveProperty('positional')
    .toEqualTypeOf<boolean | undefined>()
  expectTypeOf(z.string())
    .toHaveProperty('meta')
    .parameter(0)
    .exclude<undefined>()
    .toHaveProperty('alias')
    .toEqualTypeOf<string | undefined>()

  expectTypeOf(z.string().meta).toBeCallableWith({positional: true, alias: 'a'})
  // @ts-expect-error - this is a type error
  expectTypeOf(z.string().meta).toBeCallableWith({positional: 1, alias: 'a'})
  // @ts-expect-error - this is a type error
  expectTypeOf(z.string().meta).toBeCallableWith({positional: true, alias: true})
})
