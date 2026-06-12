/**
 * Pretty much like the `instanceof` operator, but should work across different realms. Necessary for zod because some installations
 * might result in this library using the commonjs zod export, while the user's code uses the esm export.
 * https://github.com/mmkal/trpc-cli/issues/7
 *
 * Tradeoff: It's possible that this function will return false positives if the target class has the same name as an unrelated class in the current realm.
 * So, only use it for classes that are unlikely to have name conflicts like `ZodAbc` or `TRPCDef`.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const looksLikeInstanceof = <T>(value: unknown, target: string | (new (...args: any[]) => T)): value is T => {
  let current = value?.constructor
  while (current?.name) {
    if (current?.name === (typeof target === 'string' ? target : target.name)) return true
    current = Object.getPrototypeOf(current) as typeof current // parent class
  }
  return false
}

export const kebabCase = (str: string) =>
  str
    .replaceAll(/([\da-z])([A-Z])/g, '$1-$2')
    .replaceAll(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .toLowerCase()

/**
 * The JSON Schema `type`(s) a schema can produce, looking through `enum`/`const`/`oneOf`/`anyOf`.
 * Lives here rather than json-schema.ts so that modules loaded via dynamic import (module-commands.ts) don't
 * pull in json-schema.ts's top-level-await validator probing - bun's bundler mis-hoists its `__promiseAll`
 * helper when a top-level-await module is shared between the entry and a dynamic chunk.
 */
export const getSchemaTypes = (
  propertyValue: import('json-schema').JSONSchema7,
): Array<'string' | 'boolean' | 'number' | 'integer' | (string & {})> => {
  type JSONSchema7 = import('json-schema').JSONSchema7
  const array: string[] = []
  if ('type' in propertyValue) {
    array.push(...[propertyValue.type!].flat())
  }
  if ('enum' in propertyValue && Array.isArray(propertyValue.enum)) {
    array.push(...propertyValue.enum.flatMap(s => typeof s))
  }
  if ('const' in propertyValue && propertyValue.const === null) {
    array.push('null')
  } else if ('const' in propertyValue) {
    array.push(typeof propertyValue.const)
  }
  if ('oneOf' in propertyValue) {
    array.push(...(propertyValue.oneOf as JSONSchema7[]).flatMap(getSchemaTypes))
  }
  if ('anyOf' in propertyValue) {
    array.push(...(propertyValue.anyOf as JSONSchema7[]).flatMap(getSchemaTypes))
  }

  return [...new Set(array)]
}
