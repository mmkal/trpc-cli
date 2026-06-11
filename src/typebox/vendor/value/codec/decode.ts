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

import { Arguments } from '../../system/arguments/index.js'
import { type TLocalizedValidationError } from '../../error/errors.js'
import { type TProperties, type TSchema, type StaticDecode } from '../../type/index.js'

import { AssertError } from '../assert/index.js'
import { Check } from '../check/index.js'
import { Errors } from '../errors/index.js'
import { Clean } from '../clean/index.js'
import { Clone } from '../clone/index.js'
import { Convert } from '../convert/index.js'
import { Default } from '../default/index.js'
import { Pipeline } from '../pipeline/index.js'
import { FromType } from './from_type.js'

// ------------------------------------------------------------------
// Assert
// ------------------------------------------------------------------
export class DecodeError extends AssertError {
  constructor(value: unknown, errors: TLocalizedValidationError[]) {
    super('Decode', value, errors)
  }
}
function Assert(context: TProperties, type: TSchema, value: unknown): unknown {
  if (!Check(context, type, value)) throw new DecodeError(value, Errors(context, type, value))
  return value
}
// ------------------------------------------------------------------
// DecodeUnsafe
// ------------------------------------------------------------------
/** Executes Decode callbacks only */
export function DecodeUnsafe(context: TProperties, type: TSchema, value: unknown): unknown {
  return FromType('Decode', context, type, value)
}
// ------------------------------------------------------------------
// Decoder
// ------------------------------------------------------------------
const Decoder = Pipeline([
  (_context, _type, value) => Clone(value),
  (context, type, value) => Default(context, type, value),
  (context, type, value) => Convert(context, type, value),
  (context, type, value) => Clean(context, type, value),
  (context, type, value) => Assert(context, type, value),
  (context, type, value) => DecodeUnsafe(context, type, value)
])
// ------------------------------------------------------------------
// Decode
// ------------------------------------------------------------------
/** Decodes a value with the given type. */
export function Decode<const Type extends TSchema>(type: Type, value: unknown): StaticDecode<Type>
/** Decodes a value with the given type. */
export function Decode<Context extends TProperties, const Type extends TSchema>(context: Context, type: Type, value: unknown): StaticDecode<Type, Context>
/** Decodes a value with the given type. */
export function Decode(...args: unknown[]): never {
  const [context, type, value] = Arguments.Match<[TProperties, TSchema, unknown]>(args, {
    3: (context, type, value) => [context, type, value],
    2: (type, value) => [{}, type, value],
  })
  return Decoder(context, type, value) as never
}