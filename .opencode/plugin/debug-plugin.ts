import type { Plugin } from "@opencode-ai/plugin"
import * as fs from "fs"
import { inspect } from "node:util";

export const DebugPlugin: Plugin = async ({ client }) => {
  const log = (message: string) => {
    fs.appendFileSync("/Users/mmkal/src/trpc-cli/opencode-ignoreme.log", message + "\n")
  }
  return {
    // =========================================
    // BEFORE EDITING CODE (build mode)
    // =========================================
    "tool.execute.before": async (input, output) => {
      log(inspect({m: "tool.execute.before", input, output}))
    },

    // =========================================
    // AFTER EDITING CODE (build mode)
    // =========================================
    "tool.execute.after": async (input, output) => {
      log(inspect({m: "tool.execute.after", input, output}))
    },

    // =========================================
    // TRACK PROMPTS, QUESTIONS AND ANSWERS (plan mode)
    // =========================================
    event: async ({ event }) => {
      // Track message updates (prompts and responses)
      if (event.type === "message.updated") {
        const message = event.properties as {
          role?: string
          content?: unknown
          sessionID?: string
        }

        await client.app.log({
          service: "debug-plugin",
          level: "info",
          message: `Message ${message.role === "user" ? "PROMPT" : "RESPONSE"}`,
          extra: {
            role: message.role,
            sessionID: message.sessionID,
            contentPreview: JSON.stringify(message.content)?.slice(0, 500),
          },
        })
      }

      // Track message parts (streaming responses)
      if (event.type === "message.part.updated") {
        const part = event.properties as {
          type?: string
          content?: unknown
        }

        await client.app.log({
          service: "debug-plugin",
          level: "debug",
          message: "Message part updated",
          extra: { type: part.type },
        })
      }

      // Track session status changes (can help identify plan vs build mode)
      if (event.type === "session.updated") {
        const session = event.properties as {
          id?: string
          title?: string
        }

        await client.app.log({
          service: "debug-plugin",
          level: "info",
          message: "Session updated",
          extra: session,
        })
      }

      // Track when session becomes idle (good checkpoint)
      if (event.type === "session.idle") {
        await client.app.log({
          service: "debug-plugin",
          level: "info",
          message: "Session became idle",
        })
      }

      // Track file edits via event (alternative to tool.execute.after)
      if (event.type === "file.edited") {
        const file = event.properties as {
          path?: string
        }

        await client.app.log({
          service: "debug-plugin",
          level: "info",
          message: "File edited",
          extra: { path: file.path },
        })
      }
    },
  }
}
