/** open the admin dashboard */
export default function dashboard(options: {user: string}) {
  return `dashboard ${options.user}`
}

export function invite(options: {email: string}) {
  return `invite ${options.email}`
}
