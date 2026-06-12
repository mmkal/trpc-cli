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

import { type TExtendsAny, ExtendsAny } from './any.js'
import { type TExtendsArray, ExtendsArray } from './array.js'
import { type TExtendsAsyncIterator, ExtendsAsyncIterator } from './async_iterator.js'
import { type TExtendsBigInt, ExtendsBigInt } from './bigint.js'
import { type TExtendsBoolean, ExtendsBoolean } from './boolean.js'
import { type TExtendsConstructor, ExtendsConstructor } from './constructor.js'
import { type TExtendsDependent, ExtendsDependent } from './dependent.js'
import { type TExtendsEnum, ExtendsEnum } from './enum.js'
import { type TExtendsFunction, ExtendsFunction } from './function.js'
import { type TExtendsInteger, ExtendsInteger } from './integer.js'
import { type TExtendsIntersect, ExtendsIntersect } from './intersect.js'
import { type TExtendsIterator, ExtendsIterator } from './iterator.js'
import { type TExtendsLiteral, ExtendsLiteral } from './literal.js'
import { type TExtendsNever, ExtendsNever } from './never.js'
import { type TExtendsNull, ExtendsNull } from './null.js'
import { type TExtendsNumber, ExtendsNumber } from './number.js'
import { type TExtendsObject, ExtendsObject } from './object.js'
import { type TExtendsPromise, ExtendsPromise } from './promise.js'
import { type TExtendsString, ExtendsString } from './string.js'
import { type TExtendsSymbol, ExtendsSymbol } from './symbol.js'
import { type TExtendsTemplateLiteral, ExtendsTemplateLiteral } from './template_literal.js'
import { type TExtendsTuple, ExtendsTuple  } from './tuple.js'
import { type TExtendsUndefined, ExtendsUndefined } from './undefined.js'
import { type TExtendsUnion, ExtendsUnion } from './union.js'
import { type TExtendsUnknown, ExtendsUnknown } from './unknown.js'
import { type TExtendsVoid, ExtendsVoid } from './void.js'

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------
import { type TAny, IsAny } from '../types/any.js'
import { type TArray, IsArray } from '../types/array.js'
import { type TAsyncIterator, IsAsyncIterator } from '../types/async_iterator.js'
import { type TBigInt, IsBigInt } from '../types/bigint.js'
import { type TBoolean, IsBoolean  } from '../types/boolean.js'
import { type TConstructor, IsConstructor } from '../types/constructor.js'
import { type TDependent, IsDependent } from '../types/dependent.js'
import { type TEnum, type TEnumValue, IsEnum } from '../types/enum.js'
import { type TFunction, IsFunction } from '../types/function.js'
import { type TInteger, IsInteger } from '../types/integer.js'
import { type TIntersect, IsIntersect } from '../types/intersect.js'
import { type TIterator, IsIterator } from '../types/iterator.js'
import { type TLiteral, IsLiteral } from '../types/literal.js'
import { type TNever, IsNever } from '../types/never.js'
import { type TNull, IsNull } from '../types/null.js'
import { type TNumber, IsNumber } from '../types/number.js'
import { type TObject, IsObject } from '../types/object.js'
import { type TPromise, IsPromise } from '../types/promise.js'
import { type TSchema } from '../types/schema.js'
import { type TString, IsString } from '../types/string.js'
import { type TSymbol, IsSymbol } from '../types/symbol.js'
import { type TTemplateLiteral, IsTemplateLiteral } from '../types/template_literal.js'
import { type TTuple, IsTuple } from '../types/tuple.js'
import { type TUndefined, IsUndefined } from '../types/undefined.js'
import { type TUnknown, IsUnknown } from '../types/unknown.js'
import { type TProperties } from '../types/properties.js'
import { type TUnion, IsUnion } from '../types/union.js'
import { type TVoid, IsVoid } from '../types/void.js'

import * as Result from './result.js'

// ----------------------------------------------------------------------------
// ExtendsLeft
// ----------------------------------------------------------------------------
export type TExtendsLeft<Inferred extends TProperties, Left extends TSchema, Right extends TSchema> = (
  Left extends TAny ? TExtendsAny<Inferred, Left, Right> :
  Left extends TArray<infer Items extends TSchema> ? TExtendsArray<Inferred, Left, Items, Right> :
  Left extends TAsyncIterator<infer Type extends TSchema> ? TExtendsAsyncIterator<Inferred, Type, Right> :
  Left extends TBigInt ? TExtendsBigInt<Inferred, Left, Right> :
  Left extends TBoolean ? TExtendsBoolean<Inferred, Left, Right> :
  Left extends TConstructor<infer Parameters extends TSchema[], infer InstanceType extends TSchema> ? TExtendsConstructor<Inferred, Parameters, InstanceType, Right> :
  Left extends TDependent<infer If extends TSchema, infer Then extends TSchema, infer Else extends TSchema> ? TExtendsDependent<Inferred, If, Then, Else, Right> :
  Left extends TEnum<infer Values extends TEnumValue[]> ? TExtendsEnum<Inferred, Values, Right> :
  Left extends TFunction<infer Parameters extends TSchema[], infer ReturnType extends TSchema> ? TExtendsFunction<Inferred, Parameters, ReturnType, Right> :
  Left extends TInteger ? TExtendsInteger<Inferred, Left, Right> :
  Left extends TIntersect<infer Types extends TSchema[]> ? TExtendsIntersect<Inferred, Types, Right> :
  Left extends TIterator<infer Type extends TSchema> ? TExtendsIterator<Inferred, Type, Right> :
  Left extends TLiteral ? TExtendsLiteral<Inferred, Left, Right> :
  Left extends TNever ? TExtendsNever<Inferred, Left, Right> :
  Left extends TNull ? TExtendsNull<Inferred, Left, Right> :
  Left extends TNumber ? TExtendsNumber<Inferred, Left, Right> :
  Left extends TObject<infer Properties extends TProperties> ? TExtendsObject<Inferred, Properties, Right> :
  Left extends TPromise<infer Type extends TSchema> ? TExtendsPromise<Inferred, Type, Right> :
  Left extends TString ? TExtendsString<Inferred, Left, Right> :
  Left extends TSymbol ? TExtendsSymbol<Inferred, Left, Right> :
  Left extends TTemplateLiteral<infer Pattern extends string> ? TExtendsTemplateLiteral<Inferred, Pattern, Right> :
  Left extends TTuple<infer Types extends TSchema[]> ? TExtendsTuple<Inferred, Types, Right> :
  Left extends TUndefined ? TExtendsUndefined<Inferred, Left, Right> :
  Left extends TUnion<infer Types extends TSchema[]> ? TExtendsUnion<Inferred, Types, Right> :
  Left extends TUnknown ? TExtendsUnknown<Inferred, Left, Right> :
  Left extends TVoid ? TExtendsVoid<Inferred, Left, Right> :
  Result.TExtendsFalse
)
export function ExtendsLeft<Inferred extends TProperties, Left extends TSchema, Right extends TSchema>
  (inferred: Inferred, left: Left, right: Right): 
    TExtendsLeft<Inferred, Left, Right> {
  return (
    IsAny(left) ? ExtendsAny(inferred, left, right) :
    IsArray(left) ? ExtendsArray(inferred, left, left.items, right) :
    IsAsyncIterator(left) ? ExtendsAsyncIterator(inferred, left.iteratorItems, right) :
    IsBigInt(left) ? ExtendsBigInt(inferred, left, right) :
    IsBoolean(left) ? ExtendsBoolean(inferred, left, right) :
    IsConstructor(left) ? ExtendsConstructor(inferred, left.parameters, left.instanceType, right) :
    IsDependent(left) ? ExtendsDependent(inferred, left.if, left.then, left.else, right) :
    IsEnum(left) ? ExtendsEnum(inferred, left.enum, right) :
    IsFunction(left) ? ExtendsFunction(inferred, left.parameters, left.returnType, right) :
    IsInteger(left) ? ExtendsInteger(inferred, left, right) :
    IsIntersect(left) ? ExtendsIntersect(inferred, left.allOf, right) :
    IsIterator(left) ? ExtendsIterator(inferred, left.iteratorItems, right) :
    IsLiteral(left) ? ExtendsLiteral(inferred, left, right) :
    IsNever(left) ? ExtendsNever(inferred, left, right) :
    IsNull(left) ? ExtendsNull(inferred, left, right) :
    IsNumber(left) ? ExtendsNumber(inferred, left, right) :
    IsObject(left) ? ExtendsObject(inferred, left.properties, right) :
    IsPromise(left) ? ExtendsPromise(inferred, left.item, right) :
    IsString(left) ? ExtendsString(inferred, left, right) :
    IsSymbol(left) ? ExtendsSymbol(inferred, left, right) :
    IsTemplateLiteral(left) ? ExtendsTemplateLiteral(inferred, left.pattern, right) :
    IsTuple(left) ? ExtendsTuple(inferred, left.items, right) :
    IsUndefined(left) ? ExtendsUndefined(inferred, left, right) :
    IsUnion(left) ? ExtendsUnion(inferred, left.anyOf, right) :
    IsUnknown(left) ? ExtendsUnknown(inferred, left, right) :
    IsVoid(left) ? ExtendsVoid(inferred, left, right) :
    Result.ExtendsFalse()
  ) as never
}