/*--------------------------------------------------------------------------

TypeBox

The MIT License (MIT)

Copyright (c) 2017-2026 Haydn Paterson 

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.

---------------------------------------------------------------------------*/

// deno-fmt-ignore-file

import type { XAdditionalProperties } from '../types/additionalProperties.js'
import type { XAnyOf } from '../types/anyOf.js'
import type { XAllOf } from '../types/allOf.js'
import type { XConst } from '../types/const.js'
import type { XEnum } from '../types/enum.js'
import type { XIf } from '../types/if.js'
import type { XItems } from '../types/items.js'
import type { XOneOf } from '../types/oneOf.js'
import type { XPatternProperties } from '../types/patternProperties.js'
import type { XPrefixItems } from '../types/prefixItems.js'
import type { XProperties } from '../types/properties.js'
import type { XRef } from '../types/ref.js'
import type { XRequired } from '../types/required.js'
import type { XSchema } from '../types/schema.js'
import type { XType } from '../types/type.js'
import type { XUnevaluatedProperties } from '../types/unevaluatedProperties.js'
import type { XStaticAdditionalProperties } from './additionalProperties.js'
import type { XStaticAllOf } from './allOf.js'
import type { XStaticAnyOf } from './anyOf.js'
import type { XStaticConst } from './const.js'
import type { XStaticEnum } from './enum.js'
import type { XStaticIf } from './if.js'
import type { XStaticItems } from './items.js'
import type { XStaticOneOf } from './oneOf.js'
import type { XStaticPatternProperties } from './patternProperties.js'
import type { XStaticPrefixItems } from './prefixItems.js'
import type { XStaticProperties } from './properties.js'
import type { XStaticRef } from './ref.js'
import type { XStaticRequired } from './required.js'
import type { XStaticType } from './type.js'
import type { XStaticUnevaluatedProperties } from './unevaluatedProperties.js'

// ------------------------------------------------------------------
// Keywords
// ------------------------------------------------------------------
type XFromKeywords<Stack extends string[], Root extends XSchema, Schema extends XSchema, Result extends unknown[] = [
  Schema extends XAdditionalProperties<infer Type extends XSchema> ? XStaticAdditionalProperties<Stack, Root, Type> : unknown,
  Schema extends XAllOf<infer Types extends XSchema[]> ? XStaticAllOf<Stack, Root, Types> : unknown,
  Schema extends XAnyOf<infer Types extends XSchema[]> ? XStaticAnyOf<Stack, Root, Types> : unknown,
  Schema extends XConst<infer Value extends unknown> ? XStaticConst<Value> : unknown,
  Schema extends XIf<infer Type extends XSchema> ? XStaticIf<Stack, Root, Schema, Type> : unknown,
  Schema extends XEnum<infer Values extends unknown[]> ? XStaticEnum<Values> : unknown,
  Schema extends XItems<infer Types extends XSchema[] | XSchema> ? XStaticItems<Stack, Root, Schema, Types> : unknown,
  Schema extends XOneOf<infer Types extends XSchema[]> ? XStaticOneOf<Stack, Root, Types> : unknown,
  Schema extends XPatternProperties<infer Properties extends Record<PropertyKey, XSchema>> ? XStaticPatternProperties<Stack, Root, Properties> : unknown,
  Schema extends XPrefixItems<infer Types extends XSchema[]> ? XStaticPrefixItems<Stack, Root, Schema, Types> : unknown,
  Schema extends XProperties<infer Properties extends Record<PropertyKey, XSchema>> ? XStaticProperties<Stack, Root, Schema, Properties> : unknown,
  Schema extends XRef<infer Ref extends string> ? XStaticRef<Stack, Root, Ref> : unknown,
  Schema extends XRequired<infer Keys extends string[]> ? XStaticRequired<Stack, Root, Schema, Keys> : unknown,
  Schema extends XType<infer TypeName extends string[] | string> ? XStaticType<TypeName> : unknown,
  Schema extends XUnevaluatedProperties<infer Type extends XSchema> ? XStaticUnevaluatedProperties<Stack, Root, Type> : unknown
]> = Result
// ------------------------------------------------------------------
// TIntersectKeywords
// ------------------------------------------------------------------
type XKeywordsIntersected<Schemas extends unknown[], Result extends unknown = unknown> = (
  Schemas extends [infer Left extends unknown, ...infer Right extends unknown[]]
  ? XKeywordsIntersected<Right, Result & Left>
  : Result
)
// ------------------------------------------------------------------
// XStaticEvaluate
// ------------------------------------------------------------------
type XKeywordsEvaluated<Schema extends unknown,
  Result extends unknown = Schema extends object
  ? { [Key in keyof Schema]: Schema[Key] }
  : Schema
> = Result
// ------------------------------------------------------------------
// XStaticObject
// ------------------------------------------------------------------
export type XStaticObject<Stack extends string[], Root extends XSchema, Schema extends XSchema, 
  Keywords extends unknown[] = XFromKeywords<Stack, Root, Schema>,
  Intersected extends unknown = XKeywordsIntersected<Keywords>,
  Evaluated extends unknown = XKeywordsEvaluated<Intersected>
> = Evaluated
// ------------------------------------------------------------------
// XStaticBoolean
// ------------------------------------------------------------------
export type XStaticBoolean<Schema extends boolean, 
  Result extends unknown = Schema extends false ? never : unknown
> = Result
// ------------------------------------------------------------------
// XStaticSchema
// ------------------------------------------------------------------
export type XStaticSchema<Stack extends string[], Root extends XSchema, Schema extends XSchema, 
  Result extends unknown = Schema extends boolean 
    ? XStaticBoolean<Schema> 
    : XStaticObject<Stack, Root, Schema>
> = Result