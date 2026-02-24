# Flip Agent/Command: Unified Agent Handler Refactor

**Goal:** Eliminate per-agent duplicated code by making agents data structs and moving all behavior into shared handler functions.

**Architecture:** Today each agent is an object with ~15 methods that are near-identical copies of each other. The new design inverts this: agents become plain config records (like the inspiration code in `~/code/nori/inspirations/skills/`), and the operations (`installSkillset`, `switchSkillset`, `removeSkillset`, etc.) become standalone functions that accept an `AgentConfig` parameter.

**Tech Stack:** TypeScript, existing shared infrastructure (`manifest.ts`, `template.ts`, `skillset.ts`, `config/loader.ts`)

---

## The AgentConfig Type

Each agent is defined as a data struct. Most types are simple functions that return basic types to be consumed downstream as if they were constants. `null` means the agent does not support that feature, ditto if the field is not present.

```typescript
type AgentConfig = {
  name: AgentName;
  displayName: string;

  /**
   * Relative path from installDir to the instruction file.
   * e.g. ".claude/CLAUDE.md" or ".cursor/rules/AGENTS.md"
   */
  instructionFilePath?: () => string | null;

  /**
   * Relative path from installDir to the skills directory.
   * e.g. ".claude/skills" or ".cursor/skills"
   */
  skillsPath?: () => string | null;

  /**
   * Relative path from installDir to the slashcommands directory.
   * e.g. ".claude/commands" or ".cursor/commands"
   */
  slashcommandsPath?: () => string | null;

  /**
   * Relative path from installDir to the subagents directory.
   * e.g. ".claude/agents" or ".cursor/agents"
   */
  subagentsPath?: () => string | null;

  /**
   * Extra loaders specific to this agent (hooks, statusline, announcements).
   * These run after the shared profile loaders during installSkillset.
   */
  extraLoaders?: ReadonlyArray<Loader> | null;

  /**
   * Additional managed files beyond the instruction file.
   * e.g. ["settings.json", "nori-statusline.sh"] for claude-code.
   * The instruction file basename is always included automatically.
   */
  extraManagedFiles?: ReadonlyArray<string> | null;

  /**
   * Additional managed directories beyond skills/commands/agents.
   * e.g. ["rules"] for cursor-agent (because AGENTS.md lives in .cursor/rules/).
   */
  extraManagedDirs?: ReadonlyArray<string> | null;

  /**
   * Absolute path where this agent stores session transcripts.
   * Used by the watch command. null if the agent doesn't support transcripts.
   */
  transcriptDirectory?: string | null;
};
```

## The Agent Registry

The registry becomes a simple record of configs, not a class with agent objects.

```typescript
// src/cli/features/agentRegistry.ts

const agents: Record<AgentName, AgentConfig> = {
  "claude-code": { ... },
  "cursor-agent": { ... },
};

// Helper functions (replace the old class methods)
const get = (args: { name: string }): AgentConfig => { ... };
const getAll = (): Array<AgentConfig> => { ... };
const list = (): Array<AgentName> => { ... };
const getDefaultAgentName = (): AgentName => { ... };
const getAgentDirNames = (): Array<string> => { ... };
```

The `AgentRegistry` class can stay as a singleton wrapper around these for backwards compatibility during the transition (or be replaced with a module-level record + exported functions). The key point is that `.get()` returns an `AgentConfig` (pure data), not an `Agent` (object with methods).

## The Agent Config Declarations

### Claude Code

```typescript
// src/cli/features/claude-code/agent.ts (slimmed to ~20 lines)

import { hooksLoader } from "@/cli/features/claude-code/hooks/loader.js";
import { statuslineLoader } from "@/cli/features/claude-code/statusline/loader.js";
import { announcementsLoader } from "@/cli/features/claude-code/announcements/loader.js";

export const claudeCodeConfig: AgentConfig = {
  name: "claude-code",
  displayName: "Claude Code",
  instructionFilePath: () => ".claude/CLAUDE.md",
  skillsPath: () => ".claude/skills",
  commandsPath: () => ".claude/commands",
  agentsPath: () => ".claude/agents",
  extraLoaders: [hooksLoader, statuslineLoader, announcementsLoader],
  extraManagedFiles: ["settings.json", "nori-statusline.sh"],
  transcriptDirectory: path.join(getHomeDir(), ".claude", "projects"),
};
```

### Cursor

```typescript
// src/cli/features/cursor-agent/agent.ts (slimmed to ~15 lines)

export const cursorConfig: AgentConfig = {
  name: "cursor-agent",
  displayName: "Cursor",
  instructionFilePath: () => ".cursor/rules/AGENTS.md",
  skillsPath: () => ".cursor/skills",
  commandsPath: () => ".cursor/commands",
  agentsPath: () => ".cursor/agents",
  extraManagedDirs: ["rules"],
};
```

## Shared Handler Functions

All behavior moves into standalone functions. Each takes an `AgentConfig` as the first argument. e.g.

```
isInstalledAtDir({ agentConfig, path }) → boolean
markInstall({ agentConfig, path, skillsetName }) → void
installSkillset({ agentConfig, config, skipManifest }) → Promise<void>
switchSkillset({ agentConfig, installDir, skillsetName }) → Promise<void>
detectLocalChanges({ agentConfig, installDir }) → Promise<ManifestDiff | null>
removeSkillset({ agentConfig, installDir }) → Promise<void>
```
etc

## How Callers Change

Every CLI command that currently does `agent.someMethod(args)` changes to `someMethod({ agentConfig, ...args })`.

### Before

```typescript
const agent = AgentRegistry.getInstance().get({ name: agentName });
await agent.installSkillset({ config });
await agent.removeSkillset({ installDir });
if (agent.isInstalledAtDir({ path: dir })) { ... }
```

### After

```typescript
import { installSkillset, removeSkillset, isInstalledAtDir } from "@/cli/features/shared/agentHandlers.js";

const agentConfig = AgentRegistry.getInstance().get({ name: agentName });
await installSkillset({ agentConfig, config });
await removeSkillset({ agentConfig, installDir });
if (isInstalledAtDir({ agentConfig, path: dir })) { ... }
```

## Implementation Order

This is designed to be done incrementally. Each step should leave all tests passing.

### Step 1: Create AgentConfig type and shared handlers

1. Define `AgentConfig` type in `agentRegistry.ts` alongside existing `Agent` type
3. Create `src/cli/features/shared/profileLoaders/*.ts` with shared loaders
4. Write tests for all of the above
5. **At this point both systems coexist — nothing is broken**

### Step 2: Create agent config declarations

1. Add `claudeCodeConfig` to `claude-code/agent.ts` (alongside existing `claudeCodeAgent`)
2. Add `cursorConfig` to `cursor-agent/agent.ts` (alongside existing `cursorAgent`)
3. Register configs in the registry alongside existing agents
4. **Both systems still coexist**

### Step 3: Migrate callers one by one

For each CLI command file:
1. Change `registry.get()` to return the config
2. Replace `agent.method(args)` calls with `handler({ agentConfig, ...args })` calls
3. Update the corresponding test file
4. **Run tests after each file**

### Step 4: Delete old code

Once all callers are migrated:
1. Remove `Agent` type from `agentRegistry.ts`
2. Delete the per-agent loader registries, profile loaders, and paths files
3. Delete per-agent agent method implementations
4. Delete old test files
5. Run full test suite

### Step 5: Cleanup

1. Run `npm run format` and `npm run lint`
2. Verify all tests pass
3. Delete any orphaned imports

## Edge Cases and Risks

### Cursor's instruction file lives in a subdirectory

`instructionFilePath: ".cursor/rules/AGENTS.md"` — the shared `installInstructionsMd` handler needs to `mkdir` the parent directory (`rules/`) before writing the file. This is handled by deriving the parent dir from `instructionFilePath`.

### Claude Code has permissions configuration

The Claude Code skills loader and profiles loader both configure `settings.json` permissions. In the new design, this logic stays in the Claude-specific extra loaders or is parameterized in the shared skills/profiles loaders based on whether the agent has a `settingsFilePath` or similar. Since only Claude Code needs this, the simplest approach is to keep the permissions logic as part of Claude's extra loaders.

### factoryReset capability check

`commands/factory-reset/factoryReset.ts:40` checks `agent.factoryReset == null` to gate the command. In the new design, `factoryReset` is a shared handler function that works for any agent. The capability check becomes unnecessary — every agent supports factory reset (it just walks the tree looking for the agent's directory name).

### detectExistingConfig / captureExistingConfig for Cursor

Currently only Claude Code implements these. In the new design, they're shared handler functions that work with any `AgentConfig`. Cursor will automatically gain this capability.

### The `configFileName` parameter in `parseSkillset()`

Both agents currently hardcode `configFileName: "CLAUDE.md"` when calling `parseSkillset()`. This is the source file name in `~/.nori/profiles/{skillset}/`, NOT the destination. It should stay as `"CLAUDE.md"` for all agents. If a future agent needs a different source file, add a `skillsetConfigFileName` field to `AgentConfig`.

### The Loader type stays unchanged

`Loader` is `{ name: string; description: string; run: (args: { config: Config }) => Promise<string | void> }`. Extra loaders (hooks, statusline, announcements) already implement this interface. No changes needed.

### The ProfileLoader type gets unified

Today there are two identical types: `ProfileLoader` and `CursorProfileLoader`. They get merged into a single `ProfileLoader` type: `{ name: string; description: string; install: (args: { agentConfig: AgentConfig; config: Config; skillset: Skillset }) => Promise<void> }`.

### install.ts uses `ReturnType<typeof AgentRegistry.prototype.get>` for typing

Line 95 of `install.ts` uses this pattern to type the `agent` parameter. After the change, this becomes just `AgentConfig` since that's what the registry returns.

## Backwards Compatibility

### External API impact: NONE for end users

- The CLI commands accept the same flags and produce the same outputs
- The `.nori-config.json` format is unchanged
- The file layout on disk (`.claude/CLAUDE.md`, `.claude/skills/`, etc.) is unchanged
- The manifest format is unchanged

### Internal API impact: SIGNIFICANT but mechanical

- Every file that calls `agent.method()` needs to change to `handler({ agentConfig, ... })`
- Every test that mocks agent methods needs to mock handler functions instead
- The `Agent` type is removed from the public API of `agentRegistry.ts`
- The `AgentConfig` type is the new public API

### Zero-downtime migration path

Steps 1-2 add the new system alongside the old one. Step 3 migrates callers one at a time. Step 4 removes the old code. At no point are tests broken.

---

## Testing Plan

Tests for shared profile loaders (`profileLoaders.test.ts`):

14. `installSkills` — copies skills from skillset to correct agent dir, applies template substitution, includes bundled skills
15. `installInstructionsMd` — writes managed block to correct instruction file path, handles update/clear/nested directories
16. `installSlashCommands` — copies .md files to correct commands dir
17. `installSubagents` — copies .md files to correct agents dir
18. `installProfiles` — orchestrates skills → instructions → slashcommands → subagents in order

All tests use temp directories and mock HOME. They verify filesystem outputs (files in correct locations with correct content), not internal implementation details.

NOTE: I will write *all* tests before I add any implementation behavior.

---

**Testing Details**: Integration tests for shared handler functions and profile loaders. Each test creates a synthetic `AgentConfig`, sets up a temp directory with a fake skillset, runs the handler, and asserts on filesystem state. No mock-only tests, no implementation detail tests.

**Implementation Details**:
- `Agent` type eliminated — replaced by `AgentConfig` (pure data struct)
- All Agent methods become standalone shared handler functions
- Registry becomes a simple record of `AgentConfig` entries
- ~18 files deleted, ~8 files created, net ~1000+ line reduction
- Per-agent files shrink to just data declarations (~15-20 lines each)
- `detectExistingConfig` / `captureExistingConfig` / `findArtifacts` / `factoryReset` generalized for all agents
- `ProfileLoader` and `CursorProfileLoader` unified into single type
- All CLI commands and tests updated mechanically
- Zero breaking changes for end users
