/** command merged into the barrel root */
export function rootThing(options: {value: string}) {
  return `root ${options.value}`
}

export const rootArrow = (options: {flag?: boolean}) => {
  return `arrow ${options.flag === true ? 'on' : 'off'}`
}

export default function hiddenDefault(options: {value: string}) {
  return `hidden ${options.value}`
}
