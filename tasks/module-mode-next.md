---
status: needs-grilling
size: medium
---

# Module Mode Next

Status summary: not specified yet. This task is the visible kickoff for grilling the next module-mode design questions before proposing implementation work.

## User Ask

Push module mode further and resolve these design questions:

- Do extended interfaces work? Do intersected types work?
- How should aliases be supported?
- How should overloaded functions behave?
- Can subcommands be supported without `export * as whatever from './whatever.ts'`, perhaps via exported classes?
- Can some functions opt into explicit zod/standard-schema/trpc/orpc/norpc procedure definitions while other module exports remain plain functions?

## Checklist

- [ ] Run a grill-you interview against the existing module-mode implementation.
- [ ] Document factual current behavior for extended interfaces, intersections, aliases, and overloads.
- [ ] Propose support rules for aliases, subcommands, and procedure-like exports.
- [ ] Capture open risks, tradeoffs, and follow-up implementation slices.
- [ ] Open a draft PR for review.

