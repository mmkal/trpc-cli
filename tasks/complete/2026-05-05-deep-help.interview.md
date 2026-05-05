# Deep Help Grill Interview

## Q1 - Output Shape - 2026-05-05

Question: should deep help render a tree overview only, full help blocks for
leaf commands, or full `helpInformation()` blocks for every node including
intermediate routers?

Recommended answer from sub-claude: full `helpInformation()` blocks for every
node, headed by full path.

## A1 - 2026-05-05

Choose C: full blocks for every node, including root, intermediate router
commands, and leaves. Use full command-path headings so the output scans as one
recursive document, and keep each block based on Commander `helpInformation()`
instead of rebuilding option formatting. [guess: this is most useful to coding
agents because it preserves both routing context and exact command usage.]

---

## Q2 - API Shape - 2026-05-05

Question: should deep help be a standalone `deepHelp(program:
CommanderProgramLike)` export or a method on `TrpcCli`?

Recommended answer from sub-claude: standalone export.

## A2 - 2026-05-05

Choose A: standalone `deepHelp(program: CommanderProgramLike): string` only. Do
not add a `TrpcCli` method in this pass. It matches `commandToJSON`, works with
manually customized Commander programs, and avoids making `TrpcCli` larger for
an experimental helper. [guess: if users like it, a method can be added later
without breaking compatibility.]

---

## Q3 - Section Heading Format - 2026-05-05

Question: should each command block use an equals-fence heading, a bare path, or
an underline style?

Recommended answer from sub-claude: equals-fence with full path.

## A3 - 2026-05-05

Choose A: `=== full command path ===`. Keep it boring and parseable, and avoid
adding custom formatting options in the first pass. [guess: a single stable
format is more valuable than configurability for this experimental helper.]

---

## Ready for Phase 2 - 2026-05-05

The grill-you pass converged on this implementation shape:

| Decision | Choice |
|---|---|
| Output shape | Full `helpInformation()` block per node: root, intermediate routers, and leaves |
| Node selection | All visible nodes, depth-first pre-order |
| Heading format | `=== full command path ===` |
| API | Standalone `deepHelp(program: CommanderProgramLike): string` |
| Return type | `string`; caller decides where to write it |
| `TrpcCli` method | Not in this pass |
| File | `src/json.ts`, re-exported from `src/index.ts` |
| Test file | New `test/deep-help.test.ts` |
| Normal `--help` | Untouched; helper is read-only |
