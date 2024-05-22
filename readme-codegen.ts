import {createHash} from 'crypto'
import {execaCommandSync} from 'execa'
import stripAnsi from 'strip-ansi'

export const command: import('eslint-plugin-mmkal').CodegenPreset<{command: string}> = ({options}) => {
  const result = execaCommandSync(options.command, {all: true, reject: false})
  return [
    `\`${options.command.replace(/.* test\/fixtures\//, 'node path/to/')}\` output:`,
    '',
    '```',
    stripAnsi(result.all), // includes stderr
    '```',
  ].join('\n')
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
