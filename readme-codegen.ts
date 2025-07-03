import {createHash} from 'crypto'
import stripAnsi from 'strip-ansi'

export const command: import('eslint-plugin-mmkal').CodegenPreset<{command: string; reject?: false}> = ({
  options,
  meta,
  dependencies: {zx},
}) => {
  const $ = zx.$({nothrow: !options.reject, sync: true})
  const result = $`sh -c ${options.command}`
  const output = [
    `\`${options.command.replace(/.* test\/fixtures\//, 'node path/to/')}\` output:`,
    '',
    '```',
    stripAnsi(result.stdout), // includes stderr
    '```',
  ].join('\n')

  const noWhitespace = (s: string) => s.replaceAll(/\s+/g, '')

  if (noWhitespace(output) === noWhitespace(meta.existingContent)) {
    return meta.existingContent
  }

  return output
}

export const dump: import('eslint-plugin-mmkal').CodegenPreset<{file: string}> = ({dependencies, options, meta}) => {
  const content = dependencies.fs.readFileSync(options.file, 'utf8').replaceAll(/'(\.\.\/)+src'/g, `'trpc-cli'`)
  const hash = createHash('md5').update(content).digest('hex')
  const header = `<!-- hash:${hash} -->`
  if (meta.existingContent.includes(header)) {
    return meta.existingContent // eslint-plugin-markdown "prettifies" the content - if the input hash is the same, let it be.
  }
  return [header, '```' + options.file.split('.').pop(), content, '```'].join('\n')
}
