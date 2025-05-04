export const testSuite: import('eslint-plugin-mmkal').CodegenPreset = ({
  dependencies: {path, fs, dedent},
  context,
  meta,
}) => {
  const parseTestFile = (content: string) => {
    const lines = content.split('\n').map(line => (line.trim() ? line : ''))
    const firstNonImportLine = lines.findIndex(line => line && !line.startsWith('import') && !line.startsWith('//'))
    // const codeBeforeImports = lines.slice(0, firstNonImportLine).join('\n').trim()
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

  let expected = zod3.tests
    .map(test => {
      const parsed = parseTest(test)

      const existingTest = current.tests.find(x => x.name === test.name)
      if (!existingTest) return parsed.code
      const existingParsed = parseTest(existingTest)
      const existingPlaceholders = existingParsed.placeholders
      let code = parsed.code
      const zodExamples = [] as string[]
      for (let i = 0; i < 10; i++) {
        const placeholder = `__PLACEHOLDER__${i}__()`
        if (i in parsed.placeholders) {
          zodExamples[i] = dedent(parsed.placeholders[i].original)
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
      const s = zodExamples.length > 1 ? 's' : ''
      return code.replace(
        '\n',
        [
          '',
          '/**',
          `  * Type${s} should match the following zod schema${s}`,
          '  * ```ts',
          '  * ' + zodExamples.join('\n\n').replaceAll('\n', '\n  * '),
          '  * ```',
          '  */',
          '',
        ].join('\n'),
      )
    })
    .join('\n\n')

  expected = [
    '',
    `// NOTE: the below tests are ✨generated✨ based on the hand-written tests in ${path.relative(context.physicalFilename, zod3Filename)}`,
    '// But the zod types are expected to be replaced with equivalent types (written by hand).',
    '// If you change anything other than `.input(...)` types, the linter will just undo your changes.',
    '',
    expected,
  ].join('\n')

  const removeCruft = (code: string) => {
    const splitter = '.toMatchInlineSnapshot(`'
    const chunks = code.split(splitter)
    let result = chunks[0] + splitter.replace('`', '')
    for (const chunk of chunks.slice(1)) {
      result += chunk.split('`').slice(1).join('`')
    }
    return result
      .replaceAll('// expect', 'expect')
      .replaceAll(/\n\s+\/\/.*?\n/g, '\n')
      .replaceAll(/[\s"',]+/g, '')
  }

  if (removeCruft(expected) === removeCruft(meta.existingContent)) {
    return meta.existingContent
  }
  console.log('hello!!\n', removeCruft(expected))
  return expected
}
