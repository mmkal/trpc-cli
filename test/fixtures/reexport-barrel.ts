export * from './reexport-root'
export * as admin from './reexport-admin'
export * as extra from './reexport-extra.mts'

export function localThing(options: {name: string}) {
  return `local ${options.name}`
}
