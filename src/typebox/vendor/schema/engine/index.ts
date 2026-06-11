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
// Infrastructure
// ------------------------------------------------------------------
export * from './_context.js'
export * from './_externals.js'
export * from './_guard.js'
export * from './_functions.js'
export * from './_reducer.js'
export * from './_refine.js'
export * from './_stack.js'

// ------------------------------------------------------------------
// Schematics
// ------------------------------------------------------------------
export * from './additionalItems.js'
export * from './additionalProperties.js'
export * from './allOf.js'
export * from './anyOf.js'
export * from './boolean.js'
export * from './const.js'
export * from './contains.js'
export * from './dependencies.js'
export * from './dependentRequired.js'
export * from './dependentSchemas.js'
export * from './enum.js'
export * from './exclusiveMaximum.js'
export * from './exclusiveMinimum.js'
export * from './format.js'
export * from './if.js'
export * from './items.js'
export * from './maxContains.js'
export * from './maxItems.js'
export * from './maxLength.js'
export * from './maxProperties.js'
export * from './maximum.js'
export * from './minContains.js'
export * from './minItems.js'
export * from './minLength.js'
export * from './minProperties.js'
export * from './minimum.js'
export * from './multipleOf.js'
export * from './not.js'
export * from './oneOf.js'
export * from './pattern.js'
export * from './patternProperties.js'
export * from './prefixItems.js'
export * from './properties.js'
export * from './propertyNames.js'
export * from './recursiveRef.js'
export * from './ref.js'
export * from './required.js'
export * from './schema.js'
export * from './type.js'
export * from './unevaluatedItems.js'
export * from './unevaluatedProperties.js'
export * from './uniqueItems.js'
