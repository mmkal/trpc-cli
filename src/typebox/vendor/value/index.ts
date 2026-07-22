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
// Functions
// ------------------------------------------------------------------
export * from './assert/index.js'
export * from './check/index.js'
export * from './clean/index.js'
export * from './clone/index.js'
export * from './codec/index.js'
export * from './convert/index.js'
export * from './create/index.js'
export * from './errors/index.js'
export * from './default/index.js'
export * from './equal/index.js'
export * from './hash/index.js'
export * from './mutate/index.js'
export * from './parse/index.js'
export * from './delta/index.js'
export * from './pipeline/index.js'
export * from './pointer/index.js'
export * from './repair/index.js'
// ------------------------------------------------------------------
// Shared
// ------------------------------------------------------------------
export * from './shared/index.js'
// ------------------------------------------------------------------
// Default
// ------------------------------------------------------------------
import * as Value from './value.js'
export * as Value from './value.js'
export default Value
