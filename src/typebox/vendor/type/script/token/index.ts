/*--------------------------------------------------------------------------

ParseBox

The MIT License (MIT)

Copyright (c) 2024-2026 Haydn Paterson

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

// trpc-cli local modification to upstream typebox@1.2.8
// (https://github.com/sinclairzx81/typebox @ dfec33e10fd9f3d0dc656f88b45def8e66573ab7, MIT):
// re-export the locally-added JsDoc token (see ./jsdoc.ts and src/typebox/jsdoc-description.patch).

export * from './bigint.js'
export * from './const.js'
export * from './ident.js'
export * from './integer.js'
export * from './jsdoc.js'
export * from './number.js'
export * from './rest.js'
export * from './span.js'
export * from './string.js'
export * from './unsigned_integer.js'
export * from './unsigned_number.js'
export * from './until_1.js'
export * from './until.js'
