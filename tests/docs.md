# Noridoc: tests

Path: @/tests

### Overview

- Root-level test infrastructure for the nori-skillsets repo, including global test setup/teardown and structural tests that enforce repo-level invariants (as opposed to unit tests co-located with source files in `@/src/`).
- All vitest runs load `@/tests/setup.ts` as global setup, which isolates `HOME` to a temp directory and detects Nori installation pollution after test completion.

### How it fits into the larger codebase

- `@/tests/setup.ts` is referenced in vitest config as the global setup file. Every test file across the repo (both co-located `@/src/**/*.test.ts` files and files in this directory) inherits its `beforeAll`/`afterAll` hooks for HOME isolation and pollution detection.
- `@/tests/agents-md.test.ts` enforces the structural contract of the repo's agent instruction files (`@/AGENTS.md` and `@/CLAUDE.md`). These tests ensure the symlink relationship, the close-the-loop section format, and the required fields in each verification option remain intact.

### Core Implementation

- **Pollution detection** (`setup.ts`): `detectNoriPollution()` scans a directory for Nori-specific artifacts (`.nori-config.json`, `.nori-installed-version`, `.claude/skills`, `.claude/profiles`, etc.) that are not git-tracked. The `beforeAll` hook snapshots pre-existing pollution so the `afterAll` hook only flags _new_ pollution created during the test run. A "containment break" error is thrown if tests leak installation files into the working directory.
- **AGENTS.md structural tests** (`agents-md.test.ts`): Two describe blocks -- one verifies file structure (AGENTS.md is a regular file, CLAUDE.md is a symlink to it, both resolve to identical content) and one verifies the close-the-loop section format (it is the last H2, each option has `When to use:`, `Steps:`, and `You know it works when:` fields, no duplication of test/lint commands, and skill references use the `Skill:` field).

### Things to Know

- The pollution detection distinguishes between Nori-managed `.claude/CLAUDE.md` (contains `BEGIN NORI-AI MANAGED BLOCK`) and legitimate Claude Code artifacts. Only Nori-managed files are flagged.
- The `agents-md.test.ts` tests read from the filesystem directly (not from build output), so they validate the source files as committed to the repo.
- The close-the-loop tests enforce that the section does not duplicate `npm test`, `npm run lint`, or `npm run format` commands, since those belong in the existing style guide section above.

Created and maintained by Nori.
