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

import { type TSchema } from '../../types/schema.js'
import { type TProperties } from '../../types/properties.js'
import { type TAny, IsAny } from '../../types/any.js'
import { type TArray, IsArray } from '../../types/array.js'
import { type TNever, Never } from '../../types/never.js'
import { type TObject, IsObject } from '../../types/object.js'
import { type TRecord, IsRecord } from '../../types/record.js'
import { type TTuple, IsTuple } from '../../types/tuple.js'

// ------------------------------------------------------------------
// Computed
// ------------------------------------------------------------------
import { type TFromAny, FromAny } from './from_any.js'
import { type TFromArray, FromArray } from './from_array.js'
import { type TFromObject, FromObject } from './from_object.js'
import { type TFromRecord, FromRecord } from './from_record.js'
import { type TFromTuple, FromTuple } from './from_tuple.js'

// ------------------------------------------------------------------
// Action
// ------------------------------------------------------------------
export type TFromType<Type extends TSchema> = (
  Type extends TAny ? TFromAny :
  Type extends TArray<infer Type extends TSchema> ? TFromArray<Type> :
  Type extends TObject<infer Properties extends TProperties> ? TFromObject<Properties> :
  Type extends TRecord ? TFromRecord<Type> :
  Type extends TTuple<infer Types extends TSchema[]> ? TFromTuple<Types> :
  TNever
)
export function FromType<Type extends TSchema>(type: Type): TFromType<Type> {
  return (
    IsAny(type) ? FromAny() :
    IsArray(type) ? FromArray(type.items) :
    IsObject(type) ? FromObject(type.properties) :
    IsRecord(type) ? FromRecord(type) :
    IsTuple(type) ? FromTuple(type.items) :
    Never()
  ) as never
}