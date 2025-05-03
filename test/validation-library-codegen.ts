export const testSuite: import('eslint-plugin-mmkal').CodegenPreset = ({dependencies: {path, fs}, context, meta}) => {
  const parseTestFile = (content: string) => {
    const lines = content.split('\n').map(line => (line.trim() ? line : ''))
    const firstNonImportLine = lines.findIndex(line => line && !line.startsWith('import') && !line.startsWith('//'))
    const codeBeforeImports = lines.slice(0, firstNonImportLine).join('\n').trim()
    const codeAfterImports = lines.slice(firstNonImportLine).join('\n').trim()

    const tests: Array<{name: string; code: string; startLine: number; endLine: number}> = []

    let currentTest: {name: string; code: string; startLine: number; endLine: number} | undefined
    for (const [index, line] of lines.entries()) {
      const testPrefix = 'test('
      if (line.startsWith(testPrefix)) {
        if (currentTest) throw new Error('test already started')
        const quote = line.at(testPrefix.length)
        if (quote !== '"' && quote !== "'") throw new Error('test name must be quoted')
        const name = line.slice(testPrefix.length + 1, line.indexOf(quote, testPrefix.length + 1))
        currentTest = {name, code: line, startLine: index, endLine: index}
      } else if (currentTest) {
        currentTest.code += `\n${line}`
        if (line.startsWith('})')) {
          currentTest.endLine = index
          tests.push(currentTest)
          currentTest = undefined
        }
      }
    }

    return {lines, tests, codeAfterImports, firstNonImportLine}
  }

  const zod3Filename = path.join(path.dirname(context.physicalFilename), 'zod3.test.ts')
  const zod3 = parseTestFile(fs.readFileSync(zod3Filename, 'utf8'))

  const current = parseTestFile(meta.existingContent)

  const parseTest = (test: {code: string}) => {
    const chunks = test.code.split('.input(')
    let code = chunks[0]
    const placeholders = {} as Record<number, {original: string; placeholder: string}>
    for (const [chunkIndex, chunk] of chunks.slice(1).entries()) {
      code += `.input(`
      const firstParen = chunk.indexOf('(')
      let count = 1
      const indexOfClosedParen = chunk.split('').findIndex((ch, i) => {
        if (i < firstParen) return false
        if (ch === '(') count++
        if (ch === ')') count--
        return count === 0
      })
      const placeholder = `__PLACEHOLDER__${chunkIndex}__()`
      code += placeholder
      placeholders[chunkIndex] = {original: chunk.slice(0, indexOfClosedParen), placeholder}
      code += chunk.slice(indexOfClosedParen)
    }
    return {code, placeholders}
  }

  const expected = zod3.tests
    .map(test => {
      const parsed = parseTest(test)

      //   if (Math) return parsed.code

      const existingTest = current.tests.find(x => x.name === test.name)
      if (!existingTest) return parsed.code
      const existingParsed = parseTest(existingTest)
      const existingPlaceholders = existingParsed.placeholders
      let code = parsed.code
      const legend = {} as Record<string, string>
      for (let i = 0; i < 10; i++) {
        const placeholder = `__PLACEHOLDER__${i}__()`
        if (i in parsed.placeholders) {
          legend[placeholder] = parsed.placeholders[i].original
        }
        if (
          code.includes(placeholder) &&
          existingPlaceholders[i].original &&
          existingPlaceholders[i].original !== placeholder
        ) {
          //   throw new Error(`replacing ${placeholder} with ${existingPlaceholders[i].original}`)
          code = code.replaceAll(placeholder, existingPlaceholders[i].original)
        }
      }
      return code.replace(
        '\n',
        `\n  const _legend = ${JSON.stringify(legend, null, 2)}`.replaceAll('\n', '\n  ') + '\n',
      )
      //   return parsed.code.replaceAll(/__PLACEHOLDER__(\d+)__/g, val => {
      //     const number = Number(val.replace('__PLACEHOLDER__', '').replace('__', ''))
      //     if (number in existingPlaceholders) {
      //       return existingPlaceholders[number].original
      //     }
      //     return val
      //   })
      //   const chunks = test.code.split('.input(')
      //   let code = chunks[0]
      //   for (const [chunkIndex, chunk] of chunks.slice(1).entries()) {
      //     code += `.input(`
      //     const firstParen = chunk.indexOf('(')
      //     let count = 1
      //     const indexOfClosedParen = chunk.split('').findIndex((ch, i) => {
      //       if (i < firstParen) return false
      //       if (ch === '(') count++
      //       if (ch === ')') count--
      //       return count === 0
      //     })
      //     code += `__PLACEHOLDER__${chunkIndex}__`
      //     code += chunk.slice(indexOfClosedParen)
      //   }
      //   return code
    })
    .join('\n\n')

  if (expected.replaceAll(/[\s"',]+/g, '') === meta.existingContent.replaceAll(/[\s"',]+/g, '')) {
    return meta.existingContent
  }
  return expected
}

export const testSuite2: import('eslint-plugin-mmkal').CodegenPreset = ({dependencies: {path, fs}, context, meta}) => {
  const parseTestFile = (content: string) => {
    const lines = content.split('\n').map(line => (line.trim() ? line : ''))
    const firstNonImportLine = lines.findIndex(line => line && !line.startsWith('import') && !line.startsWith('//'))
    const codeBeforeImports = lines.slice(0, firstNonImportLine).join('\n').trim()
    const codeAfterImports = lines.slice(firstNonImportLine).join('\n').trim()

    const tests: Array<{name: string; code: string; startLine: number; endLine: number}> = []

    let currentTest: {name: string; code: string; startLine: number; endLine: number} | undefined
    for (const [index, line] of lines.entries()) {
      const testPrefix = 'test('
      if (line.startsWith(testPrefix)) {
        if (currentTest) throw new Error('test already started')
        const quote = line.at(testPrefix.length)
        if (quote !== '"' && quote !== "'") throw new Error('test name must be quoted')
        const name = line.slice(testPrefix.length + 1, line.indexOf(quote, testPrefix.length + 1))
        currentTest = {name, code: line, startLine: index, endLine: index}
      } else if (currentTest) {
        currentTest.code += `\n${line}`
        if (line.startsWith('})')) {
          currentTest.endLine = index
          tests.push(currentTest)
          currentTest = undefined
        }
      }
    }

    return {lines, tests, codeAfterImports, firstNonImportLine}
  }

  const zod3Filename = path.join(path.dirname(context.physicalFilename), 'zod3.test.ts')
  const zod3 = parseTestFile(fs.readFileSync(zod3Filename, 'utf8'))

  const current = parseTestFile(meta.existingContent)

  const parseTest = (test: {code: string}) => {
    let code = ''
    const placeholders = [] as Array<{original: string; placeholder: string}>
    // let isZodDef = false
    let zodDef = ''
    let parenCount = 0
    for (const [index, ch] of test.code.split('').entries()) {
      if (zodDef) {
        zodDef += ch
        if (ch === '(') {
          parenCount++
        } else if (ch === ')') {
          parenCount--
          if (parenCount === 0) {
            const placeholder = `__PLACEHOLDER__${placeholders.length}__`
            placeholders.push({original: zodDef, placeholder})
            code += `${placeholder} /* ${zodDef.replaceAll(/\bz\./g, '.')} */`
            zodDef = ''
          }
        }
      } else {
        if (ch === 'z' && /\W/.test(test.code[index - 1]) && /\W/.test(test.code[index + 1])) {
          zodDef = ch
        } else {
          code += ch
        }
      }
    }
    return {code, placeholders}
    // const chunks = test.code.split(/\bz\b/g)
    // let code = chunks[0]
    // const placeholders = {} as Record<number, {original: string; placeholder: string}>
    // for (const [chunkIndex, chunk] of chunks.slice(1).entries()) {
    //   const placeholder = `__PLACEHOLDER__${chunkIndex}__`
    //   code += placeholder
    //   const firstParen = chunk.indexOf('(')
    //   let count = 1
    //   const indexOfClosedParen = chunk.split('').findIndex((ch, i) => {
    //     if (i < firstParen) return false
    //     if (ch === '(') count++
    //     if (ch === ')') count--
    //     return count === 0
    //   })
    //   placeholders[chunkIndex] = {original: chunk.slice(0, indexOfClosedParen), placeholder}
    //   code += chunk.slice(indexOfClosedParen)
    // }
    // return {code, placeholders}
    /*
    const chunks = test.code.split('.input(')
    let code = chunks[0]
    const placeholders = {} as Record<number, {original: string; placeholder: string}>
    for (const [chunkIndex, chunk] of chunks.slice(1).entries()) {
      code += `.input(`
      const firstParen = chunk.indexOf('(')
      let count = 1
      const indexOfClosedParen = chunk.split('').findIndex((ch, i) => {
        if (i < firstParen) return false
        if (ch === '(') count++
        if (ch === ')') count--
        return count === 0
      })
      const placeholder = `__PLACEHOLDER__${chunkIndex}__`
      code += placeholder
      placeholders[chunkIndex] = {original: chunk.slice(0, indexOfClosedParen), placeholder}
      code += chunk.slice(indexOfClosedParen)
    }
    return {code, placeholders}
    */
  }

  const expected = zod3.tests
    .map(test => {
      const parsed = parseTest(test)
      if (!parsed.placeholders.length) throw new Error(JSON.stringify({parsed}))

      const existingTest = current.tests.find(x => x.name === test.name)
      if (!existingTest) return parsed.code
      const existingParsed = parseTest(existingTest)
      const existingPlaceholders = existingParsed.placeholders
      return parsed.code.replaceAll(/__PLACEHOLDER__(\d+)__/g, val => {
        throw new Error(JSON.stringify({val, existingParsed, existingPlaceholders}))
        const number = Number(val.replace('__PLACEHOLDER__', '').replace('__', ''))
        if (number in existingPlaceholders) {
          return existingPlaceholders[number].original
        }
        return val
      })
      //   const chunks = test.code.split('.input(')
      //   let code = chunks[0]
      //   for (const [chunkIndex, chunk] of chunks.slice(1).entries()) {
      //     code += `.input(`
      //     const firstParen = chunk.indexOf('(')
      //     let count = 1
      //     const indexOfClosedParen = chunk.split('').findIndex((ch, i) => {
      //       if (i < firstParen) return false
      //       if (ch === '(') count++
      //       if (ch === ')') count--
      //       return count === 0
      //     })
      //     code += `__PLACEHOLDER__${chunkIndex}__`
      //     code += chunk.slice(indexOfClosedParen)
      //   }
      //   return code
    })
    .join('\n\n')

  if (expected.replaceAll(/[\s,]+/g, '') === meta.existingContent.replaceAll(/[\s,]+/g, '')) {
    return meta.existingContent
  }
  return expected
}
