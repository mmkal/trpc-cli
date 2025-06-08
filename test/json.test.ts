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
              "flags": "--to [string]",
              "description": "Mark migrations up to this one as exectued",
              "required": false,
              "optional": true,
              "negate": false,
              "variadic": false,
              "attributeName": "to"
            },
            {
              "name": "step",
              "flags": "--step [number]",
              "description": "Mark this many migrations as executed; Exclusive minimum: 0",
              "required": false,
              "optional": true,
              "negate": false,
              "variadic": false,
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
              "flags": "--name <string>",
              "required": true,
              "optional": false,
              "negate": false,
              "variadic": false,
              "attributeName": "name"
            },
            {
              "name": "content",
              "flags": "--content <string>",
              "required": true,
              "optional": false,
              "negate": false,
              "variadic": false,
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
              "flags": "-s, --status [string]",
              "short": "-s",
              "description": "Filter to only show migrations with this status",
              "required": false,
              "optional": true,
              "negate": false,
              "variadic": false,
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
                  "flags": "-s, --status [string]",
                  "short": "-s",
                  "description": "Filter to only show migrations with this status",
                  "required": false,
                  "optional": true,
                  "negate": false,
                  "variadic": false,
                  "attributeName": "status"
                },
                {
                  "name": "name",
                  "flags": "--name [string]",
                  "required": false,
                  "optional": true,
                  "negate": false,
                  "variadic": false,
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
                  "flags": "--status [string]",
                  "description": "Filter to only show migrations with this status",
                  "required": false,
                  "optional": true,
                  "negate": false,
                  "variadic": false,
                  "attributeName": "status"
                },
                {
                  "name": "search-term",
                  "flags": "-q, --search-term [string]",
                  "short": "-q",
                  "description": "Only show migrations whose \`content\` value contains this string",
                  "required": false,
                  "optional": true,
                  "negate": false,
                  "variadic": false,
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
