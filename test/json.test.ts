import * as trpcServer from '@trpc/server'
import {expect, test} from 'vitest'

import {z} from 'zod/v3'
import {type TrpcCliMeta} from '../src/index.js'
import {createCli} from '../src/index.js'
import * as trpcCompat from '../src/parse-router.js'

expect.addSnapshotSerializer({
  test: () => true,
  print: val => JSON.stringify(val, null, 2),
})

test('simple toJSON', async () => {
  const t = trpcServer.initTRPC.create()

  const myRouter = t.router({
    hello: t.procedure
      .input(
        z.object({
          firstName: z.string(),
          role: z.enum(['user', 'admin', 'anonymous']),
        }),
      )
      .mutation(({input}) => `hello, ${input.firstName}`),
  })

  const cli = createCli({router: myRouter, name: 'mycli', version: '1.2.3'})
  expect(cli.toJSON()).toMatchInlineSnapshot(
    `
      {
        "name": "mycli",
        "version": "1.2.3",
        "description": "Available subcommands: hello",
        "usage": "[options] [command]",
        "arguments": [],
        "options": [
          {
            "name": "version",
            "required": false,
            "optional": false,
            "negate": false,
            "variadic": false,
            "flags": "-V, --version",
            "short": "-V",
            "description": "output the version number",
            "attributeName": "version"
          }
        ],
        "commands": [
          {
            "name": "hello",
            "usage": "[options]",
            "arguments": [],
            "options": [
              {
                "name": "first-name",
                "required": true,
                "optional": false,
                "negate": false,
                "variadic": false,
                "flags": "--first-name <string>",
                "attributeName": "firstName"
              },
              {
                "name": "role",
                "required": true,
                "optional": false,
                "negate": false,
                "variadic": false,
                "flags": "--role <string>",
                "choices": [
                  "user",
                  "admin",
                  "anonymous"
                ],
                "attributeName": "role"
              }
            ],
            "commands": []
          }
        ]
      }
    `,
  )
})

test('migrations toJSON', async () => {
  const json = createCli({router: migrationsRouter}).toJSON()
  expect(json).toMatchInlineSnapshot(`
    {
      "description": "Available subcommands: up, create, list, search",
      "usage": "[options] [command]",
      "arguments": [],
      "options": [],
      "commands": [
        {
          "name": "up",
          "description": "Apply migrations. By default all pending migrations will be applied.",
          "usage": "[options]",
          "arguments": [],
          "options": [
            {
              "name": "to",
              "required": false,
              "optional": true,
              "negate": false,
              "variadic": false,
              "flags": "--to [string]",
              "description": "Mark migrations up to this one as exectued",
              "attributeName": "to"
            },
            {
              "name": "step",
              "required": false,
              "optional": true,
              "negate": false,
              "variadic": false,
              "flags": "--step [number]",
              "description": "Mark this many migrations as executed; Exclusive minimum: 0",
              "attributeName": "step"
            }
          ],
          "commands": []
        },
        {
          "name": "create",
          "description": "Create a new migration",
          "usage": "[options]",
          "arguments": [],
          "options": [
            {
              "name": "name",
              "required": true,
              "optional": false,
              "negate": false,
              "variadic": false,
              "flags": "--name <string>",
              "attributeName": "name"
            },
            {
              "name": "content",
              "required": true,
              "optional": false,
              "negate": false,
              "variadic": false,
              "flags": "--content <string>",
              "attributeName": "content"
            }
          ],
          "commands": []
        },
        {
          "name": "list",
          "description": "List all migrations",
          "usage": "[options]",
          "arguments": [],
          "options": [
            {
              "name": "status",
              "required": false,
              "optional": true,
              "negate": false,
              "variadic": false,
              "flags": "-s, --status [string]",
              "short": "-s",
              "description": "Filter to only show migrations with this status",
              "choices": [
                "executed",
                "pending"
              ],
              "attributeName": "status"
            }
          ],
          "commands": []
        },
        {
          "name": "search",
          "description": "Available subcommands: by-name, by-content",
          "usage": "[options] [command]",
          "arguments": [],
          "options": [],
          "commands": [
            {
              "name": "by-name",
              "description": "Look for migrations by name",
              "usage": "[options]",
              "arguments": [],
              "options": [
                {
                  "name": "status",
                  "required": false,
                  "optional": true,
                  "negate": false,
                  "variadic": false,
                  "flags": "-s, --status [string]",
                  "short": "-s",
                  "description": "Filter to only show migrations with this status",
                  "choices": [
                    "executed",
                    "pending"
                  ],
                  "attributeName": "status"
                },
                {
                  "name": "name",
                  "required": false,
                  "optional": true,
                  "negate": false,
                  "variadic": false,
                  "flags": "--name [string]",
                  "attributeName": "name"
                }
              ],
              "commands": []
            },
            {
              "name": "by-content",
              "description": "Look for migrations by their script content",
              "usage": "[options]",
              "arguments": [],
              "options": [
                {
                  "name": "status",
                  "required": false,
                  "optional": true,
                  "negate": false,
                  "variadic": false,
                  "flags": "--status [string]",
                  "description": "Filter to only show migrations with this status",
                  "choices": [
                    "executed",
                    "pending"
                  ],
                  "attributeName": "status"
                },
                {
                  "name": "search-term",
                  "required": false,
                  "optional": true,
                  "negate": false,
                  "variadic": false,
                  "flags": "-q, --search-term [string]",
                  "short": "-q",
                  "description": "Only show migrations whose \`content\` value contains this string",
                  "attributeName": "searchTerm"
                }
              ],
              "commands": []
            }
          ]
        }
      ]
    }
  `)
})
const trpc = trpcServer.initTRPC.meta<TrpcCliMeta>().create()

const migrations = getMigrations()

const searchProcedure = trpc.procedure
  .meta({
    aliases: {
      options: {status: 's'},
    },
  })
  .input(
    z.object({
      status: z.enum(['executed', 'pending']).optional().describe('Filter to only show migrations with this status'),
    }),
  )
  .use(async ({next, input}) => {
    return next({
      ctx: {
        filter: (list: typeof migrations) => list.filter(m => !input.status || m.status === input.status),
      },
    })
  })

const migrationsRouter = trpc.router({
  up: trpc.procedure
    .meta({description: 'Apply migrations. By default all pending migrations will be applied.'})
    .input(
      z.union([
        z.object({}).strict(), // use strict here to make sure `{step: 1}` doesn't "match" this first, just by having an ignore `step` property
        z.object({
          to: z.string().describe('Mark migrations up to this one as exectued'),
        }),
        z.object({
          step: z.number().int().positive().describe('Mark this many migrations as executed'),
        }),
      ]),
    )
    .query(async ({input}) => {
      let toBeApplied = migrations
      if ('to' in input) {
        const index = migrations.findIndex(m => m.name === input.to)
        toBeApplied = migrations.slice(0, index + 1)
      }
      if ('step' in input) {
        const start = migrations.findIndex(m => m.status === 'pending')
        toBeApplied = migrations.slice(0, start + input.step)
      }
      toBeApplied.forEach(m => (m.status = 'executed'))
      return migrations.map(m => `${m.name}: ${m.status}`)
    }),
  create: trpc.procedure
    .meta({description: 'Create a new migration'})
    .input(
      z.object({name: z.string(), content: z.string()}), //
    )
    .mutation(async ({input}) => {
      migrations.push({...input, status: 'pending'})
      return migrations
    }),
  list: searchProcedure.meta({description: 'List all migrations'}).query(({ctx}) => ctx.filter(migrations)),
  search: trpc.router({
    byName: searchProcedure
      .meta({description: 'Look for migrations by name'})
      .input(z.object({name: z.string()}))
      .query(({ctx, input}) => {
        return ctx.filter(migrations.filter(m => m.name === input.name))
      }),
    byContent: searchProcedure
      .meta({
        description: 'Look for migrations by their script content',
        aliases: {
          options: {searchTerm: 'q'},
        },
      })
      .input(
        z.object({searchTerm: z.string().describe('Only show migrations whose `content` value contains this string')}),
      )
      .query(({ctx, input}) => {
        return ctx.filter(migrations.filter(m => m.content.includes(input.searchTerm)))
      }),
  }),
}) satisfies trpcCompat.Trpc11RouterLike

function getMigrations() {
  return [
    {name: 'one', content: 'create table one(id int, name text)', status: 'executed'},
    {name: 'two', content: 'create view two as select name from one', status: 'executed'},
    {name: 'three', content: 'create table three(id int, foo int)', status: 'pending'},
    {name: 'four', content: 'create view four as select foo from three', status: 'pending'},
    {name: 'five', content: 'create table five(id int)', status: 'pending'},
  ]
}
