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

### Step 3: Migrate callers (in progress)

#### Completed caller migrations:
- `src/cli/commands/switch-skillset/switchSkillset.ts` -- replaced `agent.detectLocalChanges`, `agent.captureExistingConfig`, `agent.switchSkillset` with shared handler imports (`detectLocalChanges`, `captureExistingConfig`, `switchSkillset` from `@/cli/features/shared/agentHandlers.js`)
- `src/cli/commands/switch-skillset/switchSkillset.test.ts` -- updated test mocking from `vi.spyOn(agent, "method")` to module-level mocks of shared handlers
- `src/cli/commands/registry-install/registryInstall.ts` -- replaced `agentImpl.switchSkillset` with shared handler
- `src/cli/commands/registry-install/registryInstall.test.ts` -- updated assertions to use `expect.objectContaining` for the new `agentConfig` parameter
- `src/cli/commands/external/external.ts` -- replaced `agent.getSkillsDir`, `agent.getAgentDir` with shared handlers, changed `type Agent` to `type AgentConfig`
- `src/cli/commands/skill-download/skillDownload.ts` -- replaced `agent.getSkillsDir`, `agent.getAgentDir`, `primaryAgent.getSkillsDir`, `primaryAgent.getAgentDir` with shared handlers
- `src/cli/commands/docs.md` -- updated documentation to reflect shared handler pattern

#### Completed test migrations:
- `src/cli/features/agentRegistry.test.ts` -- full rewrite: removed `LoaderRegistry` import, changed all `agent.method()` calls to `sharedHandler({ agentConfig, ... })` pattern, replaced `agent.getTranscriptDirectory?.()` with `agent.transcriptDirectory`, replaced LoaderRegistry tests with `agent.extraLoaders` checks
- `src/cli/features/claude-code/agent.test.ts` -- full rewrite: renamed `claudeCodeAgent` to `claudeCodeConfig`, imported shared handlers (`isInstalledAtDir`, `markInstall`, `switchSkillset`), converted all method calls
- `src/cli/features/cursor-agent/agent.test.ts` -- full rewrite: renamed `cursorAgent` to `cursorConfig`, imported shared handlers (`isInstalledAtDir`, `markInstall`, `switchSkillset`, `detectLocalChanges`, `removeSkillset`, `installSkillset`, `getAgentDir`), converted all method calls
- `src/cli/commands/config/config.test.ts` -- full rewrite: mock agent is now pure data `AgentConfig` (no methods), added `vi.mock("@/cli/features/shared/agentHandlers.js")` for `removeSkillset`, `isInstalledAtDir`, `detectLocalChanges`; assertions changed from `mockAgent.removeSkillset` to `mockRemoveSkillset`; fixed `mockReturnValue` -> `mockReturnValueOnce` for multi-agent test isolation
- `src/cli/commands/install/install.test.ts` -- removed unused `AgentRegistry` import (file was already partially updated with `vi.spyOn(agentHandlers, "installSkillset")`)
- `src/cli/commands/registry-install/registryInstall.test.ts` -- changed mock agent from having `switchSkillset` method to pure data `AgentConfig`, added `vi.mock("@/cli/features/shared/agentHandlers.js")` for `switchSkillset`
- `src/cli/commands/switch-skillset/switchSkillset.test.ts` -- was already fully migrated; updated comment from "agent methods" to "shared agent handlers"

#### Bug fix in source code:
- `src/cli/features/claude-code/agent.ts` -- changed `transcriptDirectory` from eagerly-evaluated `path.join(getHomeDir(), ...)` to a lazy getter to avoid calling `getHomeDir()` at module load time, which broke tests that mock `os.homedir`

#### Remaining caller migrations (not yet started):
- None -- all test files have been migrated to the new shared handler pattern

## Not Started

### Step 4: Delete old code
- Remove `Agent` type from `agentRegistry.ts`
- Delete per-agent loader registries, profile loaders, and paths files
- Delete per-agent agent method implementations

### Step 5: Cleanup
- Run format and lint
- Verify all tests pass
- Delete orphaned imports
