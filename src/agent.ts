export type AgentEnvironment = Record<string, string | undefined>

export function isAgent(env: AgentEnvironment = process.env): boolean {
  if (isEnabled(env.CLAUDECODE)) return true
  if (isEnabled(env.CODEX_CI)) return true
  if (isEnabled(env.CODEX_THREAD_ID)) return true
  if (isEnabled(env.OPENCODE_RUN_ID) && env.OPENCODE_PROCESS_ROLE === 'worker') return true
  return false
}

function isEnabled(value: string | undefined) {
  if (!value?.trim()) return false
  const normalized = value.trim().toLowerCase()
  return normalized !== '0' && normalized !== 'false'
}
