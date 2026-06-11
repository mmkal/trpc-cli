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

// ------------------------------------------------------------------
// Engine
// ------------------------------------------------------------------
export { Instantiate, type TInstantiate } from './type/engine/instantiate.js'

// ------------------------------------------------------------------
// Extends
// ------------------------------------------------------------------
export { Extends, ExtendsResult, type TExtends } from './type/extends/index.js'

// ------------------------------------------------------------------
// Script
// ------------------------------------------------------------------
export { Script, type TScript } from './type/script/index.js'

// ------------------------------------------------------------------
// Actions
// ------------------------------------------------------------------
export { Awaited, type TAwaited, type TAwaitedDeferred } from './type/action/awaited.js'
export { Capitalize, type TCapitalize, type TCapitalizeDeferred } from './type/action/capitalize.js'
export { Conditional, type TConditional, type TConditionalDeferred } from './type/action/conditional.js'
export { ConstructorParameters, type TConstructorParameters, type TConstructorParametersDeferred } from './type/action/constructor_parameters.js'
export { Evaluate, type TEvaluate, type TEvaluateDeferred } from './type/action/evaluate.js'
export { Exclude, type TExclude, type TExcludeDeferred } from './type/action/exclude.js'
export { Extract, type TExtract, type TExtractDeferred } from './type/action/extract.js'
export { Index, type TIndex, type TIndexDeferred } from './type/action/index.js'
export { InstanceType, type TInstanceType, type TInstanceTypeDeferred } from './type/action/instance_type.js'
export { Interface, type TInterface, type TInterfaceDeferred } from './type/action/interface.js'
export { KeyOf, type TKeyOf, type TKeyOfDeferred } from './type/action/keyof.js'
export { Lowercase, type TLowercase, type TLowercaseDeferred } from './type/action/lowercase.js'
export { Mapped, type TMapped, type TMappedDeferred } from './type/action/mapped.js'
export { Module, type TModule, type TModuleDeferred } from './type/action/module.js'
export { NonNullable, type TNonNullable, type TNonNullableDeferred } from './type/action/non_nullable.js'
export { Omit, type TOmit, type TOmitDeferred } from './type/action/omit.js'
export { Parameters, type TParameters, type TParametersDeferred } from './type/action/parameters.js'
export { Partial, type TPartial, type TPartialDeferred } from './type/action/partial.js'
export { Pick, type TPick, type TPickDeferred } from './type/action/pick.js'
export { ReadonlyObject, ReadonlyType, type TReadonlyObject, type TReadonlyObjectDeferred } from './type/action/readonly_object.js'
export { Required, type TRequired, type TRequiredDeferred } from './type/action/required.js'
export { ReturnType, type TReturnType, type TReturnTypeDeferred } from './type/action/return_type.js'
export { type TUncapitalize, type TUncapitalizeDeferred, Uncapitalize } from './type/action/uncapitalize.js'
export { type TUppercase, type TUppercaseDeferred, Uppercase } from './type/action/uppercase.js'
export { Options, type TOptions, type TWith, With } from './type/action/with.js'

// ------------------------------------------------------------------
// Extension
// ------------------------------------------------------------------
export { Codec, Decode, DecodeBuilder, Encode, EncodeBuilder, IsCodec, type TCodec } from './type/types/_codec.js'
export { Immutable, IsImmutable, type TImmutable } from './type/types/_immutable.js'
export { IsOptional, Optional, type TOptional } from './type/types/_optional.js'
export { IsReadonly, Readonly, type TReadonly } from './type/types/_readonly.js'
export { IsRefine, Refine, type TRefine, type TRefineCheckCallback, type TRefineErrorCallback, type TRefinement } from './type/types/_refine.js'

// ------------------------------------------------------------------
// Standard
// ------------------------------------------------------------------
export { Any, IsAny, type TAny } from './type/types/any.js'
export { Array, IsArray, type TArray } from './type/types/array.js'
export { AsyncIterator, IsAsyncIterator, type TAsyncIterator } from './type/types/async_iterator.js'
export { Base, IsBase } from './type/types/base.js'
export { BigInt, IsBigInt, type TBigInt } from './type/types/bigint.js'
export { Boolean, IsBoolean, type TBoolean } from './type/types/boolean.js'
export { Call, IsCall, type TCall } from './type/types/call.js'
export { Constructor, IsConstructor, type TConstructor } from './type/types/constructor.js'
export { Cyclic, IsCyclic, type TCyclic } from './type/types/cyclic.js'
export { Enum, IsEnum, type TEnum, type TEnumValue } from './type/types/enum.js'
export { Function, IsFunction, type TFunction } from './type/types/function.js'
export { Generic, IsGeneric, type TGeneric } from './type/types/generic.js'
export { Identifier, IsIdentifier, type TIdentifier } from './type/types/identifier.js'
export { Dependent, IsDependent, type TDependent } from './type/types/dependent.js'
export { Infer, IsInfer, type TInfer } from './type/types/infer.js'
export { Integer, IsInteger, type TInteger } from './type/types/integer.js'
export { Intersect, IsIntersect, type TIntersect } from './type/types/intersect.js'
export { IsIterator, Iterator, type TIterator } from './type/types/iterator.js'
export { IsLiteral, Literal, type TLiteral, type TLiteralValue } from './type/types/literal.js'
export { IsNever, Never, type TNever } from './type/types/never.js'
export { IsNull, Null, type TNull } from './type/types/null.js'
export { IsNumber, Number, type TNumber } from './type/types/number.js'
export { IsObject, Object, type TObject } from './type/types/object.js'
export { IsParameter, Parameter, type TParameter } from './type/types/parameter.js'
export { IsPromise, Promise, type TPromise } from './type/types/promise.js'
export { type TProperties, type TRequiredArray } from './type/types/properties.js'
export { IsRecord, Record, RecordKey, RecordPattern, RecordValue, type TRecord, type TRecordKey, type TRecordPattern, type TRecordValue } from './type/types/record.js'
export { IsRef, Ref, type TRef } from './type/types/ref.js'
export { IsRest, Rest, type TRest } from './type/types/rest.js'
export { IsKind, IsSchema, type TArrayOptions, type TFormat, type TIntersectOptions, type TNumberOptions, type TObjectOptions, type TSchema, type TSchemaOptions, type TStringOptions, type TTupleOptions } from './type/types/schema.js'
export { type Static, type StaticDecode, type StaticEncode, type StaticParse } from './type/types/static.js'
export { IsString, String, type TString } from './type/types/string.js'
export { IsSymbol, Symbol, type TSymbol } from './type/types/symbol.js'
export { IsTemplateLiteral, TemplateLiteral, type TTemplateLiteral } from './type/types/template_literal.js'
export { IsThis, This, type TThis } from './type/types/this.js'
export { IsTuple, type TTuple, Tuple } from './type/types/tuple.js'
export { IsUndefined, type TUndefined, Undefined } from './type/types/undefined.js'
export { IsUnion, type TUnion, Union } from './type/types/union.js'
export { IsUnknown, type TUnknown, Unknown } from './type/types/unknown.js'
export { IsUnsafe, type TUnsafe, Unsafe } from './type/types/unsafe.js'
export { IsVoid, type TVoid, Void } from './type/types/void.js'
