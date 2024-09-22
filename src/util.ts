/**
 * Pretty much like the `instanceof` operator, but should work across different realms. Necessary for zod because some installations
 * might result in this library using the commonjs zod export, while the user's code uses the esm export.
 * https://github.com/mmkal/trpc-cli/issues/7
 *
 * Tradeoff: It's possible that this function will return false positives if the target class has the same name as an unrelated class in the current realm.
 * So, only use it for classes that are unlikely to have name conflicts like `ZodAbc` or `TRPCDef`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const looksLikeInstanceof = <T>(value: unknown, target: new (...args: any[]) => T): value is T => {
  let current = value?.constructor
  while (current?.name){
    if (current?.name === target.name) return true
    current = Object.getPrototypeOf(current) as Function
  }
  return false
}
