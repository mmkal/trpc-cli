// declare module 'zod/v4' {
//   interface GlobalMeta {
//     /**
//      * If true, this property will be mapped to a positional CLI argument by trpc-cli. Only valid for string, number, or boolean types (or arrays of these types).
//      * Note: the order of positional arguments is determined by the order of properties in the schema.
//      * For example, the following are different:
//      * - `z.object({abc: z.string().meta({positional: true}), xyz: z.string().meta({positional: true})})`
//      * - `z.object({xyz: z.string().meta({positional: true}), abc: z.string().meta({positional: true})})`
//      */
//     positional?: boolean
//     /**
//      * If set, this value will be used an alias for the option.
//      * Note: this is only valid for options, not positional arguments.
//      */
//     alias?: string
//   }
// }
