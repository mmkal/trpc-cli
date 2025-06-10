import {expect, test} from 'vitest'

import {createCli} from '../src'
import {router} from './fixtures/migrations'

expect.addSnapshotSerializer({
  test: () => true,
  print: val => JSON.stringify(val, null, 2),
})

test('toJSON', async () => {
  const json = createCli({router}).toJSON()
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
