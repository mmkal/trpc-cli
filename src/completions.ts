import {OmeletteInstanceLike} from '.'
import {Command} from 'commander'
import type omelette from 'omelette'

/** uses omelette to add completions to a commander program */
export function addCompletions(program: Command, completion: OmeletteInstanceLike) {
  const commandSymbol = Symbol('command')

  type TreeNode = omelette.TreeValue & {[commandSymbol]?: Command}
  const cTree = {} as TreeNode
  function addCommandCompletions(command: Command, cTreeNode: TreeNode) {
    command.commands.forEach(c => {
      const node = (cTreeNode[c.name()] ||= {}) as TreeNode
      Object.defineProperty(node, commandSymbol, {value: c, enumerable: false})
      addCommandCompletions(c, node)
    })
  }

  addCommandCompletions(program, cTree)

  completion.on('complete', (fragment, params) => {
    const segments = params.line.split(/ +/).slice(1, params.fragment)
    const last = segments.at(-1)
    let node = cTree
    const existingFlags = new Set<string>()
    for (const segment of segments) {
      if (segment.startsWith('-')) {
        existingFlags.add(segment)
        continue
      }

      if (existingFlags.size > 0) continue
      node = node[segment] as TreeNode
      if (!node) return
    }
    const correspondingCommand = node[commandSymbol]
    if (correspondingCommand?.options?.length) {
      const suggestions: string[] = []
      for (const o of correspondingCommand.options) {
        if (last === o.long || last === o.short) {
          if (o.argChoices) suggestions.push(...o.argChoices)
          if (!o.isBoolean()) break
        }

        if (existingFlags.has(o.long!)) continue
        if (existingFlags.has(o.short!)) continue

        suggestions.push(o.long!)
      }
      return void params.reply(suggestions)
    }
  })

  completion.tree(cTree as {}).init()
}
