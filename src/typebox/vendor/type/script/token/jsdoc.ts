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

// trpc-cli local modification. This file is NOT part of upstream typebox@1.2.8
// (https://github.com/sinclairzx81/typebox @ dfec33e10fd9f3d0dc656f88b45def8e66573ab7).
// It adds a JsDoc token so `Type.Script` can parse `/** ... */` comments preceding
// object properties into JSON Schema `description` fields. Adapted from mmkal's fork:
// https://github.com/sinclairzx81/typebox/compare/main...mmkal:typebox:codex/script-jsdoc-description
// (upstream issue: https://github.com/sinclairzx81/typebox/issues/1597).
// See src/typebox/jsdoc-description.patch for the full local diff.

// deno-coverage-ignore-start - parsebox tested
// deno-fmt-ignore-file

// ------------------------------------------------------------------
// Constants
// ------------------------------------------------------------------
const Open = '/**'
const Close = '*/'
// ------------------------------------------------------------------
// JsDoc
// ------------------------------------------------------------------
/** Matches a JSDoc comment and captures its content. Start and End are consumed. */
export function JsDoc(input: string): [string, string] | [] {
  const trimmed = input.trimStart()
  const index = trimmed.startsWith(Open) ? trimmed.indexOf(Close, Open.length) : -1
  return index === -1 ? [] : [Normalize(trimmed.slice(Open.length, index)), trimmed.slice(index + Close.length)]
}
// ------------------------------------------------------------------
// Normalize
// ------------------------------------------------------------------
function Normalize(input: string): string {
  return input
    .split('\n')
    .map((line) => line.replace(/^\s*\*\s?/, '').trim())
    .join('\n')
    .trim()
}
// deno-coverage-ignore-stop
