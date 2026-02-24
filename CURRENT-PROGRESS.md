# Current Progress

## Completed

### Step 1: Create AgentConfig type and shared handlers
- `AgentConfig` type defined in `src/cli/features/agentRegistry.ts`
- Shared handler functions created in `src/cli/features/shared/agentHandlers.ts`: `getAgentDir`, `getSkillsDir`, `getManagedFiles`, `getManagedDirs`, `isInstalledAtDir`, `markInstall`, `detectLocalChanges`, `removeSkillset`, `installSkillset`, `switchSkillset`, `detectExistingConfig`, `captureExistingConfig`
- Shared profile loaders created in `src/cli/features/shared/profileLoaders/`
- Tests written for shared handlers and profile loaders

### Step 2: Create agent config declarations
- `claudeCodeConfig` added to `src/cli/features/claude-code/agent.ts`
- `cursorConfig` added to `src/cli/features/cursor-agent/agent.ts`
- Configs registered in the registry alongside existing agents

### Step 3: Migrate callers (complete)

#### Completed caller migrations:
- `src/cli/commands/switch-skillset/switchSkillset.ts` -- replaced `agent.detectLocalChanges`, `agent.captureExistingConfig`, `agent.switchSkillset` with shared handler imports (`detectLocalChanges`, `captureExistingConfig`, `switchSkillset` from `@/cli/features/shared/agentHandlers.js`)
- `src/cli/commands/switch-skillset/switchSkillset.test.ts` -- updated test mocking from `vi.spyOn(agent, "method")` to module-level mocks of shared handlers
- `src/cli/commands/registry-install/registryInstall.ts` -- replaced `agentImpl.switchSkillset` with shared handler
- `src/cli/commands/registry-install/registryInstall.test.ts` -- updated assertions to use `expect.objectContaining` for the new `agentConfig` parameter
- `src/cli/commands/external/external.ts` -- replaced `agent.getSkillsDir`, `agent.getAgentDir` with shared handlers, changed `type Agent` to `type AgentConfig`
- `src/cli/commands/skill-download/skillDownload.ts` -- replaced `agent.getSkillsDir`, `agent.getAgentDir`, `primaryAgent.getSkillsDir`, `primaryAgent.getAgentDir` with shared handlers
- `src/cli/commands/install/install.ts` -- replaced `agent.installSkillset()` with shared `installSkillset({ agentConfig: agent, ... })`, changed `ReturnType<typeof AgentRegistry.prototype.get>` to `AgentConfig`
- `src/cli/commands/install/install.test.ts` -- changed spy from `agent.installSkillset` to `agentHandlers.installSkillset`
- `src/cli/commands/config/config.ts` -- replaced `agent.isInstalledAtDir()` and `agent.removeSkillset()` with shared handlers `isInstalledAtDir({ agentConfig, ... })` and `removeSkillset({ agentConfig, ... })`
- `src/cli/commands/clear/clear.ts` -- replaced `agentImpl.removeSkillset()` with shared `removeSkillset({ agentConfig, ... })`
- `src/cli/commands/init/init.ts` -- replaced `defaultAgent.isInstalledAtDir()`, `defaultAgent.detectExistingConfig?.()`, `agent.captureExistingConfig?.()`, `agent.markInstall()` with shared handlers
- `src/cli/commands/init/init.test.ts` -- updated test file creation paths from `TEST_CLAUDE_DIR` to `path.join(tempDir, ".claude")` to align with shared handler path resolution
- `src/cli/commands/watch/watch.ts` -- replaced `agentImpl.getTranscriptDirectory?.()` with `agentImpl.transcriptDirectory` (data field access)
- `src/cli/commands/factory-reset/factoryReset.ts` -- no changes needed (factoryReset, findArtifacts, displayName are already data fields on AgentConfig)
- `src/cli/commands/docs.md` -- updated documentation to reflect shared handler pattern

#### Completed test migrations:
- `src/cli/features/agentRegistry.test.ts` -- full rewrite: removed `LoaderRegistry` import, changed all `agent.method()` calls to `sharedHandler({ agentConfig, ... })` pattern, replaced `agent.getTranscriptDirectory?.()` with `agent.transcriptDirectory`, replaced LoaderRegistry tests with `agent.extraLoaders` checks
- `src/cli/features/claude-code/agent.test.ts` -- full rewrite: renamed `claudeCodeAgent` to `claudeCodeConfig`, imported shared handlers (`isInstalledAtDir`, `markInstall`, `switchSkillset`), converted all method calls
- `src/cli/features/cursor-agent/agent.test.ts` -- full rewrite: renamed `cursorAgent` to `cursorConfig`, imported shared handlers (`isInstalledAtDir`, `markInstall`, `switchSkillset`, `detectLocalChanges`, `removeSkillset`, `installSkillset`, `getAgentDir`), converted all method calls
- `src/cli/commands/config/config.test.ts` -- full rewrite: mock agent is now pure data `AgentConfig` (no methods), added `vi.mock("@/cli/features/shared/agentHandlers.js")` for `removeSkillset`, `isInstalledAtDir`, `detectLocalChanges`; assertions changed from `mockAgent.removeSkillset` to `mockRemoveSkillset`; fixed `mockReturnValue` -> `mockReturnValueOnce` for multi-agent test isolation
- `src/cli/commands/install/install.test.ts` -- changed spy from `agent.installSkillset` to `agentHandlers.installSkillset`
- `src/cli/commands/registry-install/registryInstall.test.ts` -- changed mock agent from having `switchSkillset` method to pure data `AgentConfig`, added `vi.mock("@/cli/features/shared/agentHandlers.js")` for `switchSkillset`
- `src/cli/commands/switch-skillset/switchSkillset.test.ts` -- was already fully migrated; updated comment from "agent methods" to "shared agent handlers"

#### Bug fixes:
- `src/cli/features/claude-code/agent.ts` -- changed `transcriptDirectory` from eagerly-evaluated `path.join(getHomeDir(), ...)` to a lazy getter to avoid calling `getHomeDir()` at module load time, which broke tests that mock `os.homedir`. Also fixed `Config` import to come from `@/cli/config.js` instead of `@/cli/features/agentRegistry.js`.
- `src/cli/features/agentRegistry.ts` -- fixed import ordering: changed `import type { Config }` to `import { type Config }` to resolve Prettier/ESLint conflict with import/order rule.

#### Documentation updates:
- `src/cli/features/docs.md` -- updated to reflect `AgentConfig` pure data struct pattern and shared handler functions, replaced `Agent` interface documentation with `AgentConfig` fields and shared handler function descriptions
- `src/cli/features/claude-code/docs.md` -- updated from `Agent` interface methods to `AgentConfig` data fields, references to shared handlers
- `src/cli/features/cursor-agent/docs.md` -- updated from `Agent` interface methods to `AgentConfig` data fields, references to shared handlers
- `src/cli/commands/docs.md` -- updated command descriptions to reference shared handlers instead of agent methods
- `src/cli/commands/init/docs.md` -- updated to reference shared handler functions

### Step 4: Delete old code (complete)

#### Deleted per-agent loader registries:
- `src/cli/features/claude-code/loaderRegistry.ts`
- `src/cli/features/cursor-agent/loaderRegistry.ts`

#### Deleted per-agent skillset loader registries:
- `src/cli/features/claude-code/skillsets/skillsetLoaderRegistry.ts`
- `src/cli/features/cursor-agent/skillsets/skillsetLoaderRegistry.ts`

#### Deleted per-agent skillset orchestrator loaders:
- `src/cli/features/claude-code/skillsets/loader.ts`
- `src/cli/features/cursor-agent/skillsets/loader.ts`

#### Deleted per-agent profile sub-loaders (8 files):
- `src/cli/features/claude-code/skillsets/skills/loader.ts`
- `src/cli/features/cursor-agent/skillsets/skills/loader.ts`
- `src/cli/features/claude-code/skillsets/claudemd/loader.ts`
- `src/cli/features/cursor-agent/skillsets/agentsmd/loader.ts`
- `src/cli/features/claude-code/skillsets/slashcommands/loader.ts`
- `src/cli/features/cursor-agent/skillsets/slashcommands/loader.ts`
- `src/cli/features/claude-code/skillsets/subagents/loader.ts`
- `src/cli/features/cursor-agent/skillsets/subagents/loader.ts`

#### Deleted old claude-code-specific files:
- `src/cli/features/claude-code/existingConfigCapture.ts` (replaced by shared `captureExistingConfig`)
- `src/cli/features/claude-code/existingConfigCapture.test.ts`

#### Deleted old test files (5 files):
- `src/cli/features/claude-code/skillsets/loader.test.ts`
- `src/cli/features/claude-code/skillsets/claudemd/loader.test.ts`
- `src/cli/features/claude-code/skillsets/skills/loader.test.ts`
- `src/cli/features/claude-code/skillsets/slashcommands/loader.test.ts`
- `src/cli/features/claude-code/skillsets/subagents/loader.test.ts`

#### Cleanup:
- Removed unused `Skillset` re-export from `agentRegistry.ts`
- Removed empty directories left after deletions
- Updated docs.md files in affected directories

### Step 5: Cleanup (complete)
- Format and lint pass cleanly
- All 1465 tests pass (100 test files)
- Type checking passes
- No orphaned imports remain
- `src/cli/commands/factory-reset/factoryReset.test.ts` -- cleaned up last remaining old-pattern mock: replaced `getLoaderRegistry` and `switchSkillset` method fields with proper `AgentConfig` required fields (`description`, `agentDirName`, `instructionFilePath`, `configFileName`, `skillsPath`, `slashcommandsPath`, `subagentsPath`)

## Complete

All 5 steps of the APPLICATION-SPEC have been implemented. The refactor replaced per-agent `Agent` objects (with ~15 duplicated methods each) with `AgentConfig` pure data structs and shared handler functions, eliminating ~5,400 lines of duplicated code.
