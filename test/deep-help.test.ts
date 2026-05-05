import * as trpcServer from '@trpc/server'
import {Command as CommanderCommand} from 'commander'
import {expect, test} from 'vitest'
import {z} from 'zod/v3'
import {createCli, deepHelp, type TrpcCliMeta} from '../src/index.js'

test('deepHelp renders full help blocks depth-first for visible command nodes', () => {
  const program = createCli({
    router: operationsRouter,
    name: 'ops',
    description: 'Operate services',
  }).buildProgram()

  const rootHelp = program.helpInformation()
  const output = deepHelp(program)

  expect(output.match(/^=== .* ===$/gm)).toEqual([
    '=== ops ===',
    '=== ops admin ===',
    '=== ops admin users ===',
    '=== ops admin users invite ===',
    '=== ops admin users suspend ===',
    '=== ops admin audit ===',
    '=== ops status ===',
  ])
  expect(output).toContain(rootHelp)
  expect(deepHelp(program)).toBe(output)
  expect(program.helpInformation()).toBe(rootHelp)
  expect(output).toMatchInlineSnapshot(`
    "=== ops ===
    Usage: ops [options] [command]

    Operate services
    Available subcommands: admin, status

    Options:
      -h, --help      display help for command

    Commands:
      admin           Available subcommands: users, audit
      status          Show system status.
      help [command]  display help for command

    === ops admin ===
    Usage: ops admin [options] [command]

    Available subcommands: users, audit

    Options:
      -h, --help       display help for command

    Commands:
      users            Available subcommands: invite, suspend
      audit [options]  Show audit events.
      help [command]   display help for command

    === ops admin users ===
    Usage: ops admin users [options] [command]

    Available subcommands: invite, suspend

    Options:
      -h, --help         display help for command

    Commands:
      invite [options]   Invite a user to an organization.
      suspend [options]  Suspend an existing user.
      help [command]     display help for command

    === ops admin users invite ===
    Usage: ops admin users invite [options]

    Invite a user to an organization.

    Options:
      --email <string>  Email address to invite
      --role [string]   Role for invited user (choices: "owner", "member", default:
                        "member")
      -h, --help        display help for command

    === ops admin users suspend ===
    Usage: ops admin users suspend [options]

    Suspend an existing user.

    Options:
      --user-id <string>  User identifier
      --reason [string]   Reason for suspension
      -h, --help          display help for command

    === ops admin audit ===
    Usage: ops admin audit [options]

    Show audit events.

    Options:
      --limit [number]  Number of audit events to show (default: 10)
      -h, --help        display help for command

    === ops status ===
    Usage: ops status [options]

    Show system status.

    Options:
      -h, --help  display help for command
    "
  `)
})

test('deepHelp skips hidden Commander commands', () => {
  const program = new CommanderCommand('tool')
  program.command('shown').description('Visible command')
  program.command('secret', {hidden: true}).description('Hidden command')

  expect(deepHelp(program).match(/^=== .* ===$/gm)).toEqual(['=== tool ===', '=== tool shown ==='])
})

const trpc = trpcServer.initTRPC.meta<TrpcCliMeta>().create()

const operationsRouter = trpc.router({
  admin: trpc.router({
    users: trpc.router({
      invite: trpc.procedure
        .meta({description: 'Invite a user to an organization.'})
        .input(
          z.object({
            email: z.string().describe('Email address to invite'),
            role: z.enum(['owner', 'member']).default('member').describe('Role for invited user'),
          }),
        )
        .mutation(({input}) => input),
      suspend: trpc.procedure
        .meta({description: 'Suspend an existing user.'})
        .input(
          z.object({
            userId: z.string().describe('User identifier'),
            reason: z.string().optional().describe('Reason for suspension'),
          }),
        )
        .mutation(({input}) => input),
    }),
    audit: trpc.procedure
      .meta({description: 'Show audit events.'})
      .input(
        z.object({
          limit: z.number().int().default(10).describe('Number of audit events to show'),
        }),
      )
      .query(({input}) => input),
  }),
  status: trpc.procedure.meta({description: 'Show system status.'}).query(() => 'ok'),
})
