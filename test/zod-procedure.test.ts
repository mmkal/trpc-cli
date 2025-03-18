import {expect, test} from 'vitest'
import {z} from 'zod'
import {accepts} from '../src/zod-procedure'

test('accepts strings', async () => {
  const acceptsString = accepts(z.string())

  expect(acceptsString(z.string())).toBe(true)
  expect(acceptsString(z.string().nullable())).toBe(true)
  expect(acceptsString(z.string().optional())).toBe(true)
  expect(acceptsString(z.string().nullish())).toBe(true)
  expect(acceptsString(z.number())).toBe(false)
  expect(acceptsString(z.union([z.string(), z.number()]))).toBe(true)
  expect(acceptsString(z.union([z.number(), z.boolean()]))).toBe(false)
  expect(acceptsString(z.intersection(z.string(), z.number()))).toBe(false)
  expect(acceptsString(z.intersection(z.string(), z.string().max(10)))).toBe(true)
})

test('accepts numbers', async () => {
  const acceptsNumber = accepts(z.number())

  expect(acceptsNumber(z.number())).toBe(true)
  expect(acceptsNumber(z.number().nullable())).toBe(true)
  expect(acceptsNumber(z.number().optional())).toBe(true)
  expect(acceptsNumber(z.number().nullish())).toBe(true)
  expect(acceptsNumber(z.string())).toBe(false)
  expect(acceptsNumber(z.union([z.number(), z.string()]))).toBe(true)
  expect(acceptsNumber(z.union([z.string(), z.boolean()]))).toBe(false)
  expect(acceptsNumber(z.intersection(z.number(), z.string()))).toBe(false)
  expect(acceptsNumber(z.intersection(z.number(), z.number().max(10)))).toBe(true)
})

test('accepts booleans', async () => {
  const acceptsBoolean = accepts(z.boolean())

  expect(acceptsBoolean(z.boolean())).toBe(true)
  expect(acceptsBoolean(z.boolean().nullable())).toBe(true)
  expect(acceptsBoolean(z.boolean().optional())).toBe(true)
  expect(acceptsBoolean(z.boolean().nullish())).toBe(true)
  expect(acceptsBoolean(z.string())).toBe(false)
  expect(acceptsBoolean(z.union([z.boolean(), z.string()]))).toBe(true)
  expect(acceptsBoolean(z.union([z.string(), z.number()]))).toBe(false)
  expect(acceptsBoolean(z.intersection(z.boolean(), z.string()))).toBe(false)
  expect(acceptsBoolean(z.intersection(z.boolean(), z.boolean()))).toBe(true)
})

test('accepts objects', async () => {
  const acceptsObject = accepts(z.object({}))

  expect(acceptsObject(z.object({}))).toBe(true)
  expect(acceptsObject(z.object({foo: z.string()}))).toBe(true)
  expect(acceptsObject(z.object({}).nullable())).toBe(true)
  expect(acceptsObject(z.object({}).optional())).toBe(true)
  expect(acceptsObject(z.object({}).nullish())).toBe(true)
  expect(acceptsObject(z.string())).toBe(false)
  expect(acceptsObject(z.union([z.object({}), z.string()]))).toBe(true)
  expect(acceptsObject(z.union([z.string(), z.boolean()]))).toBe(false)
  expect(acceptsObject(z.intersection(z.object({}), z.string()))).toBe(false)
  expect(acceptsObject(z.intersection(z.object({}), z.object({})))).toBe(true)
})

test('accepts record', async () => {
  const acceptsRecord = accepts(z.record(z.string()))

  expect(acceptsRecord(z.record(z.string()))).toBe(true)
  expect(acceptsRecord(z.record(z.string()).nullable())).toBe(true)
  expect(acceptsRecord(z.record(z.string()).optional())).toBe(true)
  expect(acceptsRecord(z.record(z.string()).nullish())).toBe(true)
  expect(acceptsRecord(z.string())).toBe(false)
  expect(acceptsRecord(z.union([z.record(z.string()), z.string()]))).toBe(true)
  expect(acceptsRecord(z.union([z.string(), z.boolean()]))).toBe(false)
  expect(acceptsRecord(z.intersection(z.record(z.string()), z.string()))).toBe(false)
  expect(acceptsRecord(z.intersection(z.record(z.string()), z.record(z.string())))).toBe(true)
})
