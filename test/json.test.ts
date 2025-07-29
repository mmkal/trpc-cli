import * as trpcServer from '@trpc/server'
import {expect, test} from 'vitest'

import {z} from 'zod/v3'
import {createCli} from '../src'
import {router as migrationsRouter} from './fixtures/migrations'

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
                  "required": true,
                  "optional": false,
                  "negate": false,
                  "variadic": false,
                  "flags": "--name <string>",
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
                  "required": true,
                  "optional": false,
                  "negate": false,
                  "variadic": false,
                  "flags": "-q, --search-term <string>",
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
