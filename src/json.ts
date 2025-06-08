import {Command} from 'commander'

export type CommandJSON = {
  name?: string
  version?: string
  description?: string
  usage?: string
  commands?: CommandJSON[]
  arguments?: {
    name: string
    description?: string
    required: boolean
    defaultValue?: {}
    defaultValueDescription?: string
    variadic: boolean
    choices?: string[]
  }[]
  options?: {
    name: string
    description?: string
    required: boolean
    defaultValue?: {}
    defaultValueDescription?: string
    variadic: boolean
    attributeName?: string
    flags?: string
    short?: string
    negate: boolean
    optional: boolean
  }[]
}

export const commandToJSON = (command: Command): CommandJSON => {
  const json: CommandJSON = {}
  json.name = command.name() || undefined
  json.version = command.version() || undefined
  json.description = command.description() || undefined
  json.usage = command.usage() || undefined
  json.arguments = command.registeredArguments.map(arg => ({
    name: arg.name(),
    description: arg.description || undefined,
    required: arg.required,
    defaultValue: (arg.defaultValue as {}) || undefined,
    defaultValueDescription: arg.defaultValueDescription || undefined,
    variadic: arg.variadic,
    choices: arg.argChoices || undefined,
  }))

  json.options = command.options.map(o => ({
    name: o.name(),
    flags: o.flags || undefined,
    short: o.short || undefined,
    description: o.description || undefined,
    required: o.required,
    optional: o.optional,
    negate: o.negate,
    defaultValue: (o.defaultValue as {}) || undefined,
    defaultValueDescription: o.defaultValueDescription || undefined,
    variadic: o.variadic,
    attributeName: o.attributeName() || undefined,
  }))

  json.commands = command.commands.map(c => commandToJSON(c))

  return json as {}
}
