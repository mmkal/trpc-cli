export const testSuite: import('eslint-plugin-mmkal').CodegenPreset = ({
  dependencies: {path, fs, recast, babelParser},
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

  const parseTest = (testCode: string, ast: ReturnType<typeof babelParser.parse> = recast.parse(testCode)) => {
    type CallExpression = import('eslint-plugin-mmkal').codegen.dependencies.recast.types.namedTypes.CallExpression
    const replacements = {
      inputs: [] as {argumentsCode: string}[],
      snapshots: [] as {calleeCode: string; argumentsCode: string; arguments: CallExpression['arguments']}[],
    }

    recast.visit(ast, {
      visitCallExpression(p) {
        if (
          p.node.callee.type === 'MemberExpression' &&
          p.node.callee.property.type === 'Identifier' &&
          p.node.callee.property.name === 'input' &&
          p.node.arguments.length === 1
        ) {
          const index = replacements.inputs.push({argumentsCode: recast.print(p.node.arguments[0]).code}) - 1
          p.node.arguments = [{type: 'StringLiteral', value: `INPUT_PLACEHOLDER:${index}`}]
        }
        const calleeCode = recast.print(p.node.callee).code
        if (calleeCode.trim().endsWith('toMatchInlineSnapshot') && p.node.arguments.length === 1) {
          const index =
            replacements.snapshots.push({
              calleeCode,
              argumentsCode: recast.print(p.node.arguments[0]).code,
              arguments: p.node.arguments,
            }) - 1
          p.node.arguments = [{type: 'StringLiteral', value: `SNAPSHOT_PLACEHOLDER:${index}`}]
        }
        this.traverse(p)
      },
    })

    return {
      ast,
      codeWithPlaceholders: recast.print(ast).code,
      replacements,
    }
  }

  function preprocessCode(code: string) {
    return code
      .replaceAll('// expect', '') // allow manually commenting out specific assertions
      .replaceAll('// await expect', '') // allow manually commenting out specific assertions
      .split('// extra assertions')[0] // allow adding some extra assertions
      .replaceAll('//\n', '') // get rid of comments that are just forcing prettier to make line breaks
      .trim()
  }

  function removeLineComments(code: string) {
    return code
      .split('\n')
      .filter(line => !line.trim().startsWith('//'))
      .join('\n')
  }

  let expected = zod3.tests
    .map(sourceTest => {
      const sourceParsed = parseTest(removeLineComments(preprocessCode(sourceTest.code)))

      const existingTargetTest = current.tests.find(x => x.name === sourceTest.name)
      if (!existingTargetTest) return sourceTest.code

      const existingCode = preprocessCode(existingTargetTest.code)
      const existingParsed = parseTest(existingCode)

      // the expected code is the *source* code, but we're going to swap in specific values from the existing (target) test code
      let expectedCode = sourceParsed.codeWithPlaceholders
      const inputPlaceholders = [...expectedCode.matchAll(/"INPUT_PLACEHOLDER:(\d+)"/g)].map(x => ({
        string: x[0],
        index: Number(x[1]),
      }))
      const findAndReplaces = [] as Array<{find: string; replace: string}>
      for (const pl of inputPlaceholders) {
        const existingInput = existingParsed.replacements.inputs[pl.index]
        if (existingInput) findAndReplaces.push({find: pl.string, replace: existingInput.argumentsCode})
      }
      const snapshotPlaceholders = [...expectedCode.matchAll(/"SNAPSHOT_PLACEHOLDER:(\d+)"/g)].map(x => ({
        string: x[0],
        index: Number(x[1]),
      }))
      for (const pl of snapshotPlaceholders) {
        const {calleeCode: calleeSource} = sourceParsed.replacements.snapshots[pl.index]
        const targetReplacement = existingParsed.replacements.snapshots.find(x => x.calleeCode === calleeSource)
        if (targetReplacement) findAndReplaces.push({find: pl.string, replace: targetReplacement.argumentsCode})
        if (existingTargetTest.code.includes(`// ${calleeSource}`)) {
          // if the assertion has been manually commented out, keep it commented out in the expected code
          findAndReplaces.push({find: calleeSource, replace: `// ${calleeSource}`})
        }
        if (existingTargetTest.code.includes(`// await ${calleeSource}`)) {
          // if the assertion has been manually commented out, keep it commented out in the expected code
          findAndReplaces.push({find: calleeSource, replace: `// await ${calleeSource}`})
        }
      }

      for (const r of findAndReplaces) {
        expectedCode = expectedCode.replaceAll(r.find, r.replace)
      }

      const prettyCode = (input: string) => {
        const ast = babelParser.parse(input, {sourceType: 'unambiguous', plugins: ['typescript'], attachComment: false})
        return recast.prettyPrint(ast).code
      }
      /** ignore uninteresting differences in indentation - can occur even after pretty-printing because of snapshot indentations, which vitest ignores */
      const unindentAllLines = (input: string) => {
        const lines = input.split('\n')
        return lines.map(line => line.trimStart()).join('\n')
      }
      const comparableCode = (input: string) => removeLineComments(unindentAllLines(prettyCode(preprocessCode(input))))
      // _logs.push(`
      //   source:\n${prettyCode(sourceTest.code)}\n
      //   source with placeholders:\n${prettyCode(expectedCode)}\n
      //   existing:\n${prettyCode(existingCode)}\n
      //   existing with placeholders:\n${prettyCode(existingCode)}\n
      //   expected:\n${prettyCode(expectedCode)}\n
      // `)

      if (comparableCode(expectedCode) === comparableCode(existingCode)) {
        return existingTargetTest.code
      }

      return expectedCode
      // const existingPlaceholders = existingParsed.placeholders
      // let sourceTestCode = sourceParsed.c
      // const zodExamples = [] as string[]
      // for (let i = 0; i < 10; i++) {
      //   const placeholder = `__PLACEHOLDER__${i}__()`
      //   if (i in sourceParsed.placeholders) {
      //     zodExamples[i] = dedent(sourceParsed.placeholders[i].original)
      //   }
      //   if (
      //     sourceTestCode.includes(placeholder) &&
      //     existingPlaceholders[i].original &&
      //     existingPlaceholders[i].original !== placeholder
      //   ) {
      //     //   throw new Error(`replacing ${placeholder} with ${existingPlaceholders[i].original}`)
      //     sourceTestCode = sourceTestCode.replaceAll(placeholder, existingPlaceholders[i].original)
      //   }
      // }
      // const s = zodExamples.length > 1 ? 's' : ''
      // // TODO: remove this once the diff is in
      // // eslint-disable-next-line no-constant-condition
      // if (!existingTargetTest.code.includes('__PLACEHOLDER__')) return sourceTestCode
      // return sourceTestCode.replace(
      //   '\n',
      //   [
      //     '',
      //     '/**',
      //     `  * Type${s} should match the following zod schema${s}`,
      //     '  * ```ts',
      //     '  * ' + zodExamples.join('\n\n').replaceAll('\n', '\n  * '),
      //     '  * ```',
      //     '  */',
      //     '',
      //   ].join('\n'),
      // )
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

  return expected
}
