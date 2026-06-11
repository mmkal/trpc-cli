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

import { Memory } from '../../../system/memory/index.js'
import { type TSchema, type TSchemaOptions } from '../../types/schema.js'
import { type TProperties } from '../../types/properties.js'
import { type TCyclic, IsCyclic } from '../../types/cyclic.js'
import { type TDependent, IsDependent } from '../../types/dependent.js'
import { type TIntersect, IsIntersect } from '../../types/intersect.js'
import { type TUnion, IsUnion } from '../../types/union.js'
import { type TKeyOfDeferred, KeyOfDeferred } from '../../action/keyof.js'
import { type TState, type TInstantiateType, type TCanInstantiate, InstantiateType, CanInstantiate } from '../instantiate.js'
import { type TCollapseToObject, CollapseToObject } from '../object/index.js'

// ------------------------------------------------------------------
// Computed
// ------------------------------------------------------------------
import { type TFromType, FromType } from './from_type.js'

// ------------------------------------------------------------------
//
// NormalizeType: TObject<{}> TCyclic | TIntersect | TUnion Only
//
// Note: We do not include TTuple in KeyOf normalization because
// we cannot rely on TypeScript to seqeuence collapsed keys in
// the correct order. Instead we use Tuple-length destructuring
// to yield TUnion ordering (review)
//
// Relates: TKeyOf | TIndex
//
// ------------------------------------------------------------------
type TNormalizeType<Type extends TSchema,
  Result extends TSchema = (Type extends TCyclic | TDependent | TIntersect | TUnion ? TCollapseToObject<Type> : Type)
> = Result
function NormalizeType<Type extends TSchema>(type: Type): TNormalizeType<Type> {
  const result = (IsCyclic(type) || IsDependent(type) || IsIntersect(type) || IsUnion(type) ? CollapseToObject(type) : type)
  return result as never
}
// ------------------------------------------------------------------
// Action
// ------------------------------------------------------------------
export type TKeyOfAction<Type extends TSchema, 
  Result extends TSchema = TCanInstantiate<[Type]> extends true
    ? TFromType<TNormalizeType<Type>>
    : TKeyOfDeferred<Type>
> = Result
export function KeyOfAction<Type extends TSchema>(type: Type, options: TSchemaOptions): TKeyOfAction<Type> {
  return (
    CanInstantiate([type])
    ? Memory.Update(FromType(NormalizeType(type)), {}, options)
    : KeyOfDeferred(type, options)
  ) as never
}
// ------------------------------------------------------------------
// Instantiate
// ------------------------------------------------------------------
export type TKeyOfInstantiate<Context extends TProperties, State extends TState, Type extends TSchema,
  InstantiatedType extends TSchema = TInstantiateType<Context, State, Type>
> = TKeyOfAction<InstantiatedType>
export function KeyOfInstantiate<Context extends TProperties, State extends TState, Type extends TSchema>
  (context: Context, state: State, type: Type, options: TSchemaOptions): 
    TKeyOfInstantiate<Context, State, Type> {
  const instantiatedType = InstantiateType(context, state, type)
  return KeyOfAction(instantiatedType, options) as never
}