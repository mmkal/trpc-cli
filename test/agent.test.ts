import {expect, test} from 'vitest'
import {isAgent} from '../src/index.js'

test('detects Claude Code command environments', () => {
  expect(isAgent({CLAUDECODE: '1'})).toBe(true)
})

test('detects Codex command environments', () => {
  expect(isAgent({CODEX_CI: '1'})).toBe(true)
  expect(isAgent({CODEX_THREAD_ID: '019df84d-65de-7ff3-851c-9e283198136c'})).toBe(true)
})

test('detects opencode worker shell environments', () => {
  expect(
    isAgent({
      OPENCODE_RUN_ID: '5e29ec56-6c7f-4730-a281-091f4dd240fe',
      OPENCODE_PROCESS_ROLE: 'worker',
    }),
  ).toBe(true)
})

test('ignores generic automation and configuration variables', () => {
  expect(isAgent({CI: 'true'})).toBe(false)
  expect(isAgent({OPENAI_API_KEY: 'test-key'})).toBe(false)
  expect(isAgent({CLAUDE_CODE_ENABLE_TELEMETRY: '1'})).toBe(false)
  expect(isAgent({OPENCODE_INSTALL_DIR: '/usr/local/bin'})).toBe(false)
  expect(
    isAgent({
      OPENCODE_RUN_ID: '5e29ec56-6c7f-4730-a281-091f4dd240fe',
      OPENCODE_PROCESS_ROLE: 'main',
    }),
  ).toBe(false)
})

test('ignores disabled or empty agent flags', () => {
  expect(isAgent({CLAUDECODE: '0'})).toBe(false)
  expect(isAgent({CODEX_CI: 'false'})).toBe(false)
  expect(isAgent({CODEX_THREAD_ID: ''})).toBe(false)
  expect(isAgent({OPENCODE_RUN_ID: ' ', OPENCODE_PROCESS_ROLE: 'worker'})).toBe(false)
})
