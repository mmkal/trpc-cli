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

import { IsDefault } from '../../schema/types/index.js'

import { type TProperties, type TUnion, Union } from '../../type/index.js'
import { Flatten } from '../../type/engine/evaluate/index.js'
import { Check } from '../check/index.js'
import { Clone } from '../clone/index.js'
import { Create } from '../create/index.js'
import { FromType } from './from_type.js'

import { UnionScoreSelect } from '../shared/union_score_select.js'

// ------------------------------------------------------------------
// RepairUnion
// ------------------------------------------------------------------
function RepairUnion(context: TProperties, type: TUnion, value: unknown): unknown {
  const union = Union(Flatten(type.anyOf))
  const schema = UnionScoreSelect(context, union, value)
  return FromType(context, schema, value)
}
export function FromUnion(context: TProperties, type: TUnion, value: unknown): unknown {
  if (Check(context, type, value)) return Clone(value)
  if (IsDefault(type)) return Create(context, type)
  return RepairUnion(context, type, value)
}