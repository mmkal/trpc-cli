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

/**
 * Convert a commander `Command` instance to a JSON object.
 *
 * Note: in theory you could use this with any `Command` instance, it doesn't have
 * to be one built by `trpc-cli`. Implementing here because it's pretty simple to do and `commander` doesn't seem to provide a way to do it.
 *
 * Note: falsy values for strings are replaced with `undefined` in the output - e.g. if there's an empty description, it will be `undefined` in the output.
 */
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
