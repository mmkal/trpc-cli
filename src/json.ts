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
  const name = command.name()

  if (name) json.name = name
  const version = command.version()
  if (version) json.version = version
  const description = command.description()
  if (description) json.description = description
  const usage = command.usage()
  if (usage) json.usage = usage

  json.arguments = command.registeredArguments.map(arg => {
    const result = {name: arg.name()} as NonNullable<CommandJSON['arguments']>[number]

    result.variadic = arg.variadic
    result.required = arg.required

    if (arg.description) result.description = arg.description
    if (arg.defaultValue) result.defaultValue = arg.defaultValue as {}
    if (arg.defaultValueDescription) result.defaultValueDescription = arg.defaultValueDescription
    if (arg.argChoices) result.choices = arg.argChoices
    return result
  })

  json.options = command.options.map(o => {
    const result = {name: o.name()} as NonNullable<CommandJSON['options']>[number]

    result.required = o.required
    result.optional = o.optional
    result.negate = o.negate
    result.variadic = o.variadic

    if (o.flags) result.flags = o.flags
    if (o.short) result.short = o.short
    if (o.description) result.description = o.description

    const attributeName = o.attributeName()
    if (attributeName) result.attributeName = attributeName

    if (o.defaultValue) result.defaultValue = o.defaultValue as {}
    if (o.defaultValueDescription) result.defaultValueDescription = o.defaultValueDescription

    return result
  })

  json.commands = command.commands.map(c => commandToJSON(c))

  return json as {}
}
