# Noridoc: test-utils

Path: @/src/cli/features/test-utils

### Overview

Shared test utilities providing standardized helpers for common test operations across the codebase. Reduces duplication in test setup and assertions.

### How it fits into the larger codebase

Imported by test files throughout `@/src/cli/` for consistent temporary directory management, file existence checks, and ANSI stripping. Test files use `createTempTestContext` for basic temp directory needs and `createIsolatedTestContext` for integration tests requiring full HOME directory isolation.

### Core Implementation

`stripAnsi` removes ANSI escape codes from strings for plain text comparison in test assertions. `pathExists` wraps `fs.access` into a boolean promise. `createTempTestContext` creates a temp directory with an agent config subdirectory (defaults to `.claude/`, overridable via the `agentDirName` parameter) and returns a cleanup function. `createIsolatedTestContext` extends the temp context by also creating `.nori/profiles/` within the temp directory and setting `NORI_GLOBAL_CONFIG` to the temp directory, providing complete isolation from the real home directory. Its cleanup restores the original `NORI_GLOBAL_CONFIG` value.

### Things to Know

`IsolatedTestContext` manipulates the `NORI_GLOBAL_CONFIG` environment variable, which the `getHomeDir()` utility in `@/src/utils/home.ts` checks to determine the home directory. This is the mechanism that redirects all path resolution away from the real `~/.nori/` and `~/.claude/` during tests.

Created and maintained by Nori.
