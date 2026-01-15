import type { Plugin } from "@opencode-ai/plugin"
import * as fs from "fs"
import { inspect } from "util";

const log = (data: unknown, {depth = null as null | number} = {}) => {
  let m = inspect(data, {breakLength: Number.MAX_SAFE_INTEGER, depth, colors: false})
  try {m = JSON.stringify(data)} catch {}
  fs.appendFileSync("/Users/mmkal/src/trpc-cli/autocommit-ignoreme.log", m + "\n")
}

type Message = {
  id: string
  role: string
  text: string
}
type SessionInfo = {
  title: string
  messages: Message[]
}

export const AutoCommitPlugin: Plugin = async ({ client, $, worktree }) => {
  return {
    event: async ({ event }) => {
      log(event)
    },
  }
}

// import type { Plugin } from "@opencode-ai/plugin"
// import * as fs from "fs"
// import { inspect } from "util";

// const log = (data: unknown, {depth = null as null | number} = {}) => {
//   let m = inspect(data, {breakLength: Number.MAX_SAFE_INTEGER, depth, colors: false})
//   try {m = JSON.stringify(data)} catch {}
//   fs.appendFileSync("/Users/mmkal/src/trpc-cli/autocommit-ignoreme.log", m + "\n")
// }
// type PromptRecord = {
//   messageID: string
//   text: string
//   agent: string
//   committed: boolean
// }

// type SessionState = {
//   prompts: PromptRecord[]
//   hasBuildMode: boolean
// }

// const sessions = new Map<string, SessionState>()
// const helperSessions = new Set<string>()

// function getSession(sessionID: string): SessionState {
//   if (!sessions.has(sessionID)) {
//     sessions.set(sessionID, {
//       prompts: [],
//       hasBuildMode: false,
//     })
//   }
//   return sessions.get(sessionID)!
// }

// function extractUserPromptText(parts: Array<{ type: string; text?: string }>): string {
//   return parts
//     .filter((p) => p.type === "text" && p.text)
//     .map((p) => p.text!)
//     .join("\n")
//     .trim()
// }

// function detectPlanQA(prompts: PromptRecord[]): Array<{ question: string; answer: string }> {
//   const qa: Array<{ question: string; answer: string }> = []

//   for (const prompt of prompts) {
//     if (prompt.agent !== "plan") continue

//     const lines = prompt.text.split("\n").filter((l) => l.trim())
//     for (const line of lines) {
//       const match = line.match(/^\s*(\d+)\s*[.):]\s*(.+)/)
//       if (match) {
//         qa.push({
//           question: `Question ${match[1]}`,
//           answer: match[2].trim(),
//         })
//       }
//     }
//   }

//   return qa
// }

// function generateTitleFromPrompt(prompt: string): string {
//   // Extract a meaningful title from the prompt
//   // Take first sentence or first 50 chars
//   const firstLine = prompt.split(/[.\n]/)[0].trim()
//   const cleaned = firstLine
//     .toLowerCase()
//     .replace(/^(please|can you|could you|i want to|i need to|let's|let us)\s+/i, "")
//     .replace(/[^\w\s-]/g, " ")
//     .replace(/\s+/g, " ")
//     .trim()

//   if (cleaned.length <= 50) return cleaned || "update code"
//   return cleaned.slice(0, 47) + "..."
// }

// async function generateCommitMessage(
//   client: Parameters<Plugin>[0]["client"],
//   prompt: string,
//   isError: boolean,
// ): Promise<{ title: string; body: string }> {
//   const systemPrompt = `Generate a git commit message. Rules:
// - Title: present tense imperative (add/fix/update), lowercase, max 50 chars
// - Body: 1-2 sentences on intent
// ${isError ? "- Note: PARTIAL changes due to error" : ""}
// Respond ONLY with JSON: {"title":"...","body":"..."}`

//   const userInput = `Request: "${prompt.slice(0, 300)}"`

//   // Create a temporary session for commit message generation
//   const session = await client.session.create({ title: "[auto-commit-helper]" }).catch(() => null)
//   if (!session?.data?.id) {
//     return { title: generateTitleFromPrompt(prompt), body: "" }
//   }

//   const sessionID = session.data.id
//   helperSessions.add(sessionID)

//   // Subscribe to events
//   const events = await client.event.subscribe().catch(() => null)
//   if (!events) {
//     helperSessions.delete(sessionID)
//     await client.session.delete({ sessionID }).catch(() => {})
//     return { title: generateTitleFromPrompt(prompt), body: "" }
//   }

//   // Send prompt with tools disabled
//   await client.session
//     .promptAsync({
//       sessionID,
//       system: systemPrompt,
//       tools: {}, // Disable all tools
//       parts: [{ type: "text", text: userInput }],
//     })
//     .catch(() => {})

//   // Wait for completion with timeout
//   const waitForIdle = async () => {
//     for await (const event of events.stream) {
//       if (event.type === "session.idle" && event.properties.sessionID === sessionID) break
//       if (event.type === "session.error" && event.properties.sessionID === sessionID) break
//     }
//   }

//   await Promise.race([waitForIdle(), new Promise((r) => setTimeout(r, 15000))])

//   // Get response
//   const messages = await client.session.messages({ sessionID }).catch(() => null)
//   helperSessions.delete(sessionID)
//   await client.session.delete({ sessionID }).catch(() => {})

//   if (!messages?.data) {
//     return { title: generateTitleFromPrompt(prompt), body: "" }
//   }

//   const assistantMsg = messages.data.find((m) => m.info.role === "assistant")
//   const textPart = assistantMsg?.parts.find((p) => p.type === "text")
//   const responseText = textPart && "text" in textPart ? textPart.text : ""

//   const jsonMatch = responseText.match(/\{[^{}]*"title"\s*:\s*"([^"]*)"[^{}]*"body"\s*:\s*"([^"]*)"[^{}]*\}/)
//   if (jsonMatch) {
//     return {
//       title: (jsonMatch[1] || generateTitleFromPrompt(prompt)).slice(0, 50),
//       body: jsonMatch[2] || "",
//     }
//   }

//   return { title: generateTitleFromPrompt(prompt), body: "" }
// }

// export const AutoCommitPlugin: Plugin = async ({ client, $, worktree }) => {
//   return {
//     event: async ({ event }) => {
//       log(event)
//       if (event.type === "message.updated") {
//         const msg = event.properties.info
//         const sessionID = msg.sessionID

//         // Ignore helper sessions
//         if (helperSessions.has(sessionID)) return

//         if (msg.role === "user") {
//           const state = getSession(sessionID)
//           const response = await client.session.message({ sessionID, messageID: msg.id }).catch(() => null)
//           const parts = response?.data?.parts || []

//           const text = extractUserPromptText(parts)
//           if (text) {
//             const existing = state.prompts.find((p) => p.messageID === msg.id)
//             if (!existing) {
//               state.prompts.push({
//                 messageID: msg.id,
//                 text,
//                 agent: msg.agent,
//                 committed: false,
//               })
//             }
//           }
//         }

//         if (msg.role === "assistant" && !msg.agent.includes("plan")) {
//           const state = getSession(sessionID)
//           state.hasBuildMode = true
//         }
//       }

//       if (event.type === "file.edited") {
//         const file = event.properties.file
//         log(`[no-op] would run: git add ${file}`)
//         // await $`git add ${file}`
//         //   .cwd(worktree)
//         //   .quiet()
//         //   .catch(() => {})
//       }

//       if (event.type === "session.idle" || event.type === "session.error") {
//         const sessionID = event.properties.sessionID

//         // Ignore helper sessions
//         if (helperSessions.has(sessionID)) return

//         const state = sessions.get(sessionID)
//         if (!state) return

//         const isError = event.type === "session.error"

//         log({hasBuildMode: state.hasBuildMode, state})
//         if (!state.hasBuildMode) return

//         const uncommittedPrompts = state.prompts.filter((p) => !p.committed && p.agent === "build")
//         if (uncommittedPrompts.length === 0) return

//         log(`[no-op] would run: git status --porcelain`)
//         const status = "" // await $`git status --porcelain`.cwd(worktree).text().catch(() => "")
//         if (!status.trim()) {
//           for (const p of uncommittedPrompts) {
//             p.committed = true
//           }
//           return
//         }

//         const planPrompts = state.prompts.filter((p) => !p.committed && p.agent === "plan")
//         const planQA = detectPlanQA(planPrompts)

//         for (const prompt of uncommittedPrompts) {
//           const { title, body } = await generateCommitMessage(client, prompt.text, isError)

//           let commitBody = body
//           if (prompt.text) {
//             commitBody += `\n\nPrompt: "${prompt.text}"`
//           }

//           if (planQA.length > 0) {
//             commitBody += "\n\n--- Plan Mode Discussion ---"
//             for (const qa of planQA) {
//               commitBody += `\n${qa.question}: ${qa.answer}`
//             }
//           }

//           if (isError) {
//             commitBody += "\n\n[!] This commit contains partial/incomplete changes due to an error."
//           }

//           const commitMessage = `${title}\n\n${commitBody.trim()}`

//           log(`[no-op] would run: git commit -m ${JSON.stringify(commitMessage)}`)
//           const committed = false

//           if (committed) {
//             prompt.committed = true
//             for (const p of planPrompts) {
//               p.committed = true
//             }
//           }
//         }
//       }
//     },
//   }
// }
