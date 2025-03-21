function explainJsonSchema() {
  // Helper to check if something is an object (not null)
  const isObject = function (object: any): boolean {
    return typeof object === 'object' && object !== null
  }

  const count = function (i: number): string {
    if (i === 1) return '1th'
    if (i === 2) return '2nd'
    if (i === 3) return '3rd'
    return i + 'th'
  }

  const not_null = function (prop: any): boolean {
    return prop !== null
  }

  // Create a standalone conjunction function instead of extending Array prototype
  const conjunction = function (arr: any[], word: string, depth?: number, less_lines?: boolean): string {
    if (typeof depth !== 'number') depth = 0
    const sep = '  '.repeat(depth + 1) + '* '
    const r = arr.filter(not_null).map((e: any, i: number, arr: any[]) => {
      if (less_lines && arr.length === 1) {
        return e
      }
      if (i !== arr.length - 1) {
        if (e.toString().includes('    ' + sep) && word == 'or ') {
          e += '\n' + sep + word
        } else if (e.toString().includes('  ' + sep)) {
          e += ', ' + word
        } else {
          e += word
        }
      }
      if (e[0] !== '\n') e = '\n' + sep + e
      return e
    })
    return r.join('')
  }

  // Replace exports with local state
  let global_schema: any = null

  const getref = function (object: any): any {
    if (typeof object['$ref'] === 'string') {
      let o = global_schema
      const path = object['$ref'].replace(/^#\//, '')
      path.split(/\//).forEach((p: string) => {
        if (o.hasOwnProperty(p) && typeof o[p] === 'object' && o[p] !== null) {
          o = o[p]
        } else {
          throw new Error('ref not found.')
        }
      })
      o.path = path
      return o
    }
    return object
  }

  const explain = function (element: any, depth?: number, hard?: boolean): string | null {
    if (global_schema == null) {
      global_schema = element
      const re = explain(element, depth, hard)
      global_schema = null
      return re
    }
    element = getref(element)
    if (typeof depth !== 'number') depth = 0
    const r: string[] = []
    if (element.deprecated === true) {
      const rr = 'is deprecated'
      r.push(rr)
    }
    // const
    if (element.const !== undefined) {
      r.push('is `' + element.const + '` ')
      return conjunction(r, 'and ', depth, true)
    }
    // enum
    else if (Array.isArray(element.enum)) {
      if (element.enum.length === 0) {
        return 'never'
      } else if (element.enum.length === 1) {
        r.push('is `' + element.enum[0] + '` ')
        return conjunction(r, 'and ', depth, true)
      } else {
        r.push(
          conjunction(
            element.enum.map((e: any) => 'is `' + e + '` '),
            'or ',
            depth,
          ),
        )
        return conjunction(r, 'and ', depth)
      }
    }
    if (hard) {
      if (element.type == 'null') {
        const rr = 'is of type `' + element.type + '` '
        r.push(rr)
      }
    } else {
      // type
      if (typeof element.type == 'string') {
        const rr = 'is of type `' + element.type + '` '
        r.push(rr)
      }
      if (Array.isArray(element.type)) {
        const rr =
          'is of type ' +
          conjunction(
            element.type.map((e: any) => '`' + e + '`'),
            'or ',
            depth + 1,
          ) +
          ' '
        r.push(rr)
      }
      // number
      const rwhere: string[] = []
      if (typeof element.minimum === 'number') {
        const rr = 'is at least ' + element.minimum + ' '
        rwhere.push(rr)
      }
      if (typeof element.exclusiveMinimum === 'number') {
        const rr = 'is larger than ' + element.exclusiveMinimum + ' '
        rwhere.push(rr)
      }
      if (typeof element.maximum === 'number') {
        const rr = 'is not larger than ' + element.maximum + ' '
        rwhere.push(rr)
      }
      if (typeof element.exclusiveMaximum === 'number') {
        const rr = 'is lower than ' + element.exclusiveMaximum + ' '
        rwhere.push(rr)
      }
      if (typeof element.multipleOf === 'number') {
        const rr = 'is a multiple of ' + element.multipleOf + ' '
        rwhere.push(rr)
      }
      if (rwhere.length) {
        r.push('has a numeric value that ' + conjunction(rwhere, 'and ', depth + 1))
      }
      // string
      if (typeof element.format === 'string') {
        const rr = 'has *' + element.format + '* format '
        r.push(rr)
      }
      if (typeof element.pattern === 'string') {
        const rr = 'matches pattern `' + element.pattern + '` '
        r.push(rr)
      }
      if (typeof element.minLength === 'number') {
        const rr = 'is at least ' + element.minLength + ' characters long '
        r.push(rr)
      }
      if (typeof element.maxLength === 'number') {
        const rr = 'is not longer than ' + element.maxLength + ' characters '
        r.push(rr)
      }
      if (typeof element.contentMediaType === 'string') {
        const rr = 'has a media type of `' + element.contentMediaType + '`'
        r.push(rr)
      }
      if (typeof element.contentEncoding === 'string') {
        const rr = 'has a media type of `' + element.contentEncoding + '`'
        r.push(rr)
      }
    }

    // object: properties
    let prefix = 'has '
    if (isObject(element.properties) || isObject(element.patternProperties) || isObject(element.propertyNames)) {
      if (!hard && typeof element.minProperties === 'number') {
        prefix += 'at least ' + element.minProperties + ' '
        if (typeof element.maxProperties === 'number') {
          prefix += 'but '
        }
      }
      if (!hard && typeof element.maxProperties === 'number') {
        prefix += 'not more than ' + element.maxProperties + ' '
      }
      prefix += 'properties, where<br/>'
    }
    if (!hard && isObject(element.propertyNames) && typeof element.propertyNames.pattern === 'string') {
      const rr = prefix + 'all property names match `' + element.propertyNames.pattern + '` '
      prefix = ''
      r.push(rr)
    }
    if (isObject(element.properties)) {
      const rr = conjunction(
        Object.keys(element.properties).map(prop => {
          const ep = element.properties[prop]
          let r = prefix
          if (Array.isArray(element.required)) {
            if (element.required.includes(prop)) {
              r += 'required '
            } else {
              r += 'optional '
              if (hard) return null
            }
          }
          r += 'property **' + prop + '** '
          const rr = explain(ep, depth + 1, hard)
          if (rr === null || rr === '') return null
          prefix = ''
          return r + rr
        }),
        'and ',
        depth,
      )
      r.push(rr)
    }
    // object: patternProperties
    if (!hard && isObject(element.patternProperties)) {
      const rr = conjunction(
        Object.keys(element.patternProperties).map(prop => {
          const ep = element.patternProperties[prop]
          let r = prefix
          r += 'the property key name matches `' + prop + '` and the value '
          const rr = explain(ep, depth + 1, hard)
          if (rr === null || rr === '') return null
          prefix = ''
          return r + rr
        }),
        'and ',
        depth,
      )
      r.push(rr)
    }
    // array: items
    if (Array.isArray(element.items)) {
      let rr = 'has '
      if (!hard && typeof element.minItems === 'number') {
        rr += 'at least ' + element.minItems + ' '
        if (typeof element.maxItems === 'number') {
          rr += 'but '
        }
      }
      if (!hard && typeof element.maxItems === 'number') {
        rr += 'not more than ' + element.maxItems + ' '
      }
      rr += 'items, where<br/>'
      element.items.forEach((item: any, i: number) => {
        rr += 'the ' + count(i + 1) + ' item '
        const re = explain(item, depth + 1, hard)
        if (re !== null) r.push(rr + re)
        rr = ''
      })
    } else if (isObject(element.items)) {
      let rr = 'has '
      if (!hard && typeof element.minItems === 'number') {
        rr += 'at least ' + element.minItems + ' '
        if (typeof element.maxItems === 'number') {
          rr += 'but '
        }
      }
      if (!hard && typeof element.maxItems === 'number') {
        rr += 'not more than ' + element.maxItems + ' '
      }
      if (!hard && element.uniqueItems === true) {
        rr += 'unique '
      }
      rr += 'items, where every item '
      const re = explain(element.items, depth + 1, hard)

      if (re != null) r.push(rr + re)
    }
    // array: contains
    if (isObject(element.contains)) {
      let rr = 'contains '
      if (typeof element.minContains === 'number') {
        rr += 'at least ' + element.minContains + ' '
        if (typeof element.maxContains === 'number') {
          rr += 'but '
        }
      }
      if (typeof element.maxContains === 'number') {
        rr += 'not more than ' + element.maxContains + ' '
      }
      rr += 'items, where every item '
      rr += explain(element.contains, depth + 1, false)

      r.push(rr)
    }

    // oneOf / anyOf / allOf / not
    if (Array.isArray(element.anyOf)) {
      const rr = conjunction(
        element.anyOf.map((e: any) => explain(e, depth + 1, hard)),
        'or ',
        depth,
      )
      if (rr) r.push('either ' + rr)
    }
    if (Array.isArray(element.oneOf)) {
      const rr = conjunction(
        element.oneOf.map((e: any) => explain(e, depth + 1, hard)),
        'or ',
        depth,
      )
      if (rr) r.push('either ' + rr)
    }
    if (Array.isArray(element.allOf)) {
      const rr = conjunction(
        element.allOf.map((e: any) => explain(e, depth + 1, hard)),
        'and ',
        depth,
      )
      if (rr) r.push('all of ' + rr)
    }
    if (isObject(element.not)) {
      const rr = explain(element.not, depth + 1, hard)
      if (!rr) return 'never'
      else if (rr !== 'never') r.push('never ' + rr)
    }

    // if/then/else
    if (isObject(element.if)) {
      let rr = explain(element.if, depth + 1, false)
      if (rr !== null) r.push('if ' + rr)
      if (isObject(element.then)) {
        rr = explain(element.then, depth + 1, hard)
        if (rr !== null) r.push('then ' + rr)
      }
      if (isObject(element.else)) {
        rr = explain(element.else, depth + 1, hard)
        if (rr !== null) r.push('else ' + rr)
      }
    }

    // object: additionalProperties
    if (!hard && element.additionalProperties === false) {
      r.push('has no more properties ')
    } else if (!hard && isObject(element.additionalProperties)) {
      const rr = explain(element.additionalProperties, depth + 1, hard)
      r.push('each additional property' + rr)
    }

    return conjunction(r, 'and ', depth)
  }

  // Return helpers instead of using exports
  return {
    explain,
    isObject,
    count,
    conjunction,
  }
}

export const {explain, isObject, count, conjunction} = explainJsonSchema()
