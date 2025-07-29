/* eslint-disable @typescript-eslint/unbound-method */
import {test, expectTypeOf} from 'vitest'
import {z} from 'zod/v4'
import {EnquirerLike, InquirerPromptsLike, Promptable} from '../src'

test('prompt types', async () => {
  expectTypeOf<typeof import('@inquirer/prompts')>().toExtend<InquirerPromptsLike>()
  expectTypeOf<typeof import('enquirer')>().toExtend<EnquirerLike>()

  expectTypeOf<typeof import('@inquirer/prompts')>().toExtend<Promptable>()
  expectTypeOf<typeof import('enquirer')>().toExtend<Promptable>()
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
