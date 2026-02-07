# Noridoc: test-utils

Path: @/src/cli/features/test-utils

### Overview

- Shared test utilities for consistent test patterns across the codebase
- Provides three core utilities: `stripAnsi`, `pathExists`, and `createTempTestContext`
- Reduces code duplication across test files in claude-code and CLI commands

### How it fits into the larger codebase

- Located in @/src/cli/features/ because utilities are shared across multiple feature modules (not agent-specific)
- Imported by test files via `@/cli/features/test-utils/index.js`
- Used by intercepted slash command tests in @/src/cli/features/claude-code/
- Used by CLI command tests in @/src/cli/commands/

```
Test Files (*.test.ts)
    |
    +-- import { stripAnsi, pathExists, createTempTestContext } from "@/cli/features/test-utils/index.js"
    |
    +-- Strip ANSI codes from CLI output for assertions
    +-- Check file/directory existence
    +-- Create isolated temp directories with .claude subdirectory
```

### Core Implementation

| Utility | Purpose | Style |
|---------|---------|-------|
| `stripAnsi(str)` | Removes ANSI escape codes from strings for plain text comparison | Simple parameter (not named args) for ergonomics in assertions |
| `pathExists({ filePath })` | Async check if file/directory exists | Named args following codebase convention |
| `createTempTestContext({ prefix })` | Creates temp directory with `.claude` subdirectory and cleanup function | Returns `TempTestContext` object |

**TempTestContext Type:**
- `tempDir`: Root temporary directory path
- `claudeDir`: Path to `.claude` subdirectory within tempDir
- `cleanup()`: Async function to remove the temp directory after test

### Things to Know

**`stripAnsi` uses a simple parameter intentionally.** While the codebase style guide mandates named args, `stripAnsi` takes a plain string parameter for ergonomics since it's called frequently in test assertions like `expect(stripAnsi(output)).toContain("Success")`. This exception is documented in the function's JSDoc.

**`createTempTestContext` always creates a `.claude` subdirectory.** This matches the standard directory structure expected by most test scenarios involving agent configuration.

**Cleanup responsibility.** Tests using `createTempTestContext` must call `cleanup()` in an `afterEach` hook to avoid leaving temp directories on disk.

Created and maintained by Nori.
