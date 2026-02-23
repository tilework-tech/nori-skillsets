# Current Progress

## Completed

### Commit 1: Extract agent-agnostic code from claude-code directory

**Refactor A progress:** Moved agent-agnostic utilities out of `src/cli/features/claude-code/` into shared `src/cli/features/` locations. Added `getAgentDir` to the Agent interface.

Changes:
- Created `src/cli/features/paths.ts` with `getNoriDir()` and `getNoriSkillsetsDir()` (moved from `claude-code/paths.ts`)
- Created `src/cli/features/skillsetMetadata.ts` with `readSkillsetMetadata`, `writeSkillsetMetadata`, `addSkillToNoriJson`, `ensureNoriJson` (moved from `claude-code/skillsets/metadata.ts`, old file deleted)
- Created `src/cli/features/template.ts` with `substituteTemplatePaths` (moved from `claude-code/template.ts`, old file deleted)
- Added `getAgentDir({ installDir })` to the `Agent` interface in `agentRegistry.ts`
- Implemented `getAgentDir` on the claude-code agent (returns `<installDir>/.claude`)
- Updated 15+ command files and internal feature files to import from new shared locations
- Updated all test mocks to cover the new module paths
- Moved test files for metadata and template to new shared locations
- Updated 6 docs.md files

### Commit 2: Replace hardcoded claude-code references in CLI commands

**Refactor A progress:** CLI commands no longer import claude-code-specific paths directly. They use the Agent interface from `agentRegistry.ts` instead.

Changes:
- Added `AgentArtifact` type, `getSkillsDir()`, `getProjectsDir?()`, `findArtifacts?()` to Agent interface in `agentRegistry.ts`
- Renamed `ExistingConfig.hasClaudeMd` → `hasConfigFile` (agent-agnostic name)
- Implemented new methods on claude-code agent (`agent.ts`)
- Relocated `manifest.ts` from `claude-code/skillsets/manifest.ts` to `src/cli/features/manifest.ts` (renamed `claudeDir` param to `agentDir` in `removeManagedFiles`)
- Relocated `skillResolver.ts` from `claude-code/skillsets/skills/resolver.ts` to `src/cli/features/skillResolver.ts`
- Deleted old `manifest.ts` and `resolver.ts` source files
- Updated 7 CLI commands to use agent interface methods instead of hardcoded paths:
  - `config.ts`, `switchSkillset.ts`, `install.ts` → `agent.getAgentDir()` + shared manifest
  - `external.ts`, `skillDownload.ts` → `agent.getSkillsDir()` + shared resolver
  - `factoryReset.ts` → `agent.findArtifacts()`
  - `watch.ts` → `agent.getProjectsDir()`
- Removed dead `getClaudeProjectsDir()` from `watch/paths.ts`
- Updated `init.ts`, `existingConfigCapture.ts` for `hasConfigFile` rename
- Updated all test mocks and assertions for new import paths and param names

### Commit 3: Introduce explicit Skillset type and parseSkillset function

**Refactor B progress:** Created a centralized `Skillset` type and `parseSkillset()` function. Profile sub-loaders no longer independently construct filesystem paths — they receive a pre-parsed `Skillset` object.

Changes:
- Created `src/cli/features/skillset.ts` with `Skillset` type and `parseSkillset()` function
  - `Skillset` maps the filesystem structure: `name`, `dir`, `metadata`, `skillsDir`, `configFilePath`, `slashcommandsDir`, `subagentsDir` (nullable for optional components)
  - `parseSkillset()` resolves skillset directory, ensures nori.json exists (backwards compat), reads metadata, checks for optional component directories
- Created `src/cli/features/skillset.test.ts` with 8 tests covering fully-populated, minimal, namespaced, missing, and legacy skillsets
- Updated `ProfileLoader` interface in `skillsetLoaderRegistry.ts` to accept `{ config: Config; skillset: Skillset }`
- Updated `profilesLoader` in `loader.ts` to call `parseSkillset()` once and pass result to all sub-loaders
- Updated all 4 profile sub-loaders to consume `Skillset` instead of constructing paths independently:
  - `skills/loader.ts` — removed `getProfileDir`, `getConfigDir`; uses `skillset.skillsDir`
  - `claudemd/loader.ts` — removed `getProfileClaudeMd`; uses `skillset.configFilePath`; `generateSkillsList` now takes `{ skillsDir }` instead of `{ skillsetName }`
  - `slashcommands/loader.ts` — removed `getConfigDir`; uses `skillset.slashcommandsDir`
  - `subagents/loader.ts` — removed `getConfigDir`; uses `skillset.subagentsDir`
- Updated `agent.ts` `captureExistingConfig` to parse skillset before calling `claudeMdLoader.install`
- Updated all 4 sub-loader test files with `installWithSkillset` helper pattern

### Commit 4: Remove hardcoded agent fallbacks and make Skillset type agent-agnostic

**Refactor A + B progress:** Eliminated all hardcoded `"claude-code"` string fallbacks outside the agent registration itself. Made the `Skillset` type fully agent-agnostic. Added `getSkillDiscoveryDirs` to the Agent interface.

Changes:
- Added `getDefaultAgentName()` method to `AgentRegistry` — returns the first registered agent name as canonical fallback
- Added `getSkillDiscoveryDirs()` to `Agent` interface — returns relative directory paths for skill discovery in repos
- Implemented `getSkillDiscoveryDirs()` on claude-code agent returning `[".claude/skills"]`
- Renamed `Skillset.claudeMdPath` → `Skillset.configFilePath` — agent-agnostic field name
- Updated `claudemd/loader.ts` to read `skillset.configFilePath`
- Replaced 5 hardcoded `"claude-code"` fallbacks with `AgentRegistry.getInstance().getDefaultAgentName()`:
  - `config.ts` `getDefaultAgents()` fallback
  - `install.ts` `noninteractive()` agent fallback
  - `noriSkillsetsCommands.ts` watch command default agent
  - `switchSkillset.ts` agent resolution fallback
  - `config.ts` (prompts/flows) initial agent selection
- Removed legacy `~/.claude/.nori-config.json` path from `checkForUpdate.ts`
- Updated `skillDiscovery.ts` to use agent registry `getSkillDiscoveryDirs()` instead of hardcoded `.claude/skills`
- Renamed `TempTestContext.claudeDir` → `TempTestContext.agentDir` in test utilities
- Updated init flow warning text to be agent-agnostic (no longer references `~/.claude/` paths)
- Updated 3 docs.md files

### Commit 5: Add `detectLocalChanges` and `removeSkillset` to Agent interface

**Refactor C progress:** Added semantic agent-level lifecycle methods for change detection and skillset removal. Command handlers now delegate to agent methods instead of reimplementing the logic inline.

Changes:
- Added `detectLocalChanges({ installDir })` to `Agent` type — returns `ManifestDiff | null`
- Added `removeSkillset({ installDir })` to `Agent` type — removes all managed files via manifest
- Implemented both on claude-code agent in `agent.ts`:
  - `detectLocalChanges` reads manifest (with legacy fallback), compares against current agent dir state
  - `removeSkillset` calls `removeManagedFiles` for both current and legacy manifest paths
- Refactored `switchSkillset.ts` command: removed private `detectLocalChanges` function, callers now use `agent.detectLocalChanges()`
- Refactored `config.ts` command: replaced inline `removeManagedFiles` assembly pattern with `agent.removeSkillset({ installDir })`
- Removed unused manifest module imports from `switchSkillset.ts` and `config.ts`
- Added 5 new tests for the agent methods in `agentRegistry.test.ts`
- Updated Agent mock in `config.test.ts` to include new methods; updated 3 tests to assert on `agent.removeSkillset` instead of `removeManagedFiles`
- Updated 3 docs.md files

### Commit 6: Add `installSkillset` to Agent interface

**Refactor C progress:** Added `installSkillset` to the Agent interface, completing the lifecycle triumvirate alongside `detectLocalChanges` and `removeSkillset`. The install command now delegates the entire installation flow to the agent.

Changes:
- Added `installSkillset({ config })` to `Agent` type in `agentRegistry.ts`
- Implemented on claude-code agent in `agent.ts`: runs all feature loaders, computes/writes manifest, marks install directory
- Refactored `install.ts`: removed `runFeatureLoaders` and `writeInstalledManifest` private functions; `completeInstallation` now delegates to `agent.installSkillset({ config })`
- Added 3 new tests in `agentRegistry.test.ts`:
  - Verifies marker file and manifest are created after installation
  - Verifies installed state is detectable by `detectLocalChanges` (round-trip test)
  - Verifies completion without error on valid config
- Updated Agent mock in `config.test.ts` to include `installSkillset`
- Updated docs.md files

### Commit 7: Add `getConfigFileName` to Agent interface and parameterize shared code

**Refactor A + B progress:** Added `getConfigFileName()` to the Agent interface and parameterized `parseSkillset()` and `createTempTestContext()` so they no longer hardcode Claude-specific values ("CLAUDE.md", ".claude").

Changes:
- Added `getConfigFileName: () => string` to `Agent` type in `agentRegistry.ts`
- Implemented `getConfigFileName: () => "CLAUDE.md"` on claude-code agent in `agent.ts`
- Added optional `configFileName` parameter to `parseSkillset()` in `skillset.ts` — defaults to "CLAUDE.md" for backwards compatibility, enabling callers to pass `agent.getConfigFileName()` for agent-specific resolution
- Added optional `agentDirName` parameter to `createTempTestContext()` in `test-utils/index.ts` — defaults to ".claude", enabling tests for non-Claude agents
- Added 2 tests in `agentRegistry.test.ts` for `getConfigFileName` (direct + registry-wide)
- Added 3 tests in `skillset.test.ts` for custom configFileName, missing configFileName, and direct skillsetDir path
- Added 1 test in `test-utils/index.test.ts` for custom agentDirName
- Updated 3 docs.md files

### Commit 8: Handle removed agent cleanup, move `getProjectDirName` to Agent interface, pass `configFileName` explicitly

**Refactor A + C progress:** Completed three agent-decoupling improvements: config command now handles removed agent cleanup, Claude-specific project directory naming moved to Agent interface, and `parseSkillset()` calls now explicitly pass `configFileName`.

Changes:
- Added optional `getProjectDirName({ cwd })` to `Agent` type in `agentRegistry.ts` — converts working directory path to agent's project directory name format
- Implemented `getProjectDirName` on claude-code agent in `agent.ts` — moved logic from `getClaudeProjectDir` in `watch/paths.ts`
- Removed `getClaudeProjectDir` from `watch/paths.ts` (was dead code — only used in tests, never called from production code)
- Updated `watch/paths.test.ts` — tests now use `agent.getProjectDirName!()` via the agent interface instead of the removed function
- Config command (`config.ts`) `agentsChanged` branch now detects removed agents and added agents separately:
  - When agents are removed: prompts user to clean up managed files via `agent.removeSkillset()`
  - When agents are added: prompts user to install skillset for new agents (existing behavior)
- Added 2 new tests in `config.test.ts` for removed agent cleanup (accept and decline scenarios)
- Added 2 new tests in `agentRegistry.test.ts` for `getProjectDirName`
- `parseSkillset()` calls in `claude-code/agent.ts` and `claude-code/skillsets/loader.ts` now explicitly pass `configFileName` instead of relying on the `"CLAUDE.md"` default
- Updated 3 docs.md files

### Commit 9: Remove hardcoded agent-specific values from shared utilities

**Refactor A + B progress:** Removed the last hardcoded agent-specific strings (`.claude`, `"CLAUDE.md"`) from shared utility code. Added `getAgentDirNames()` to AgentRegistry. All shared utilities are now fully agent-agnostic.

Changes:
- Parameterized `normalizeInstallDir()` in `src/utils/path.ts`: added optional `agentDirNames` param; removed hardcoded `.claude` suffix stripping. Callers must now explicitly pass agent dir names to enable suffix stripping.
- Parameterized `resolveInstallDir()` in `src/utils/path.ts`: added `agentDirNames` pass-through param.
- Parameterized `ensureNoriJson()` and `looksLikeSkillset()` in `src/cli/features/skillsetMetadata.ts`: added optional `configFileNames` param (defaults to `["CLAUDE.md"]`). `looksLikeSkillset` now iterates over provided file names instead of hardcoding `"CLAUDE.md"`.
- Added `getAgentDirNames()` to `AgentRegistry` class: returns basenames of all registered agent config directories (e.g., `[".claude"]`), derived from `agent.getAgentDir()`.
- Updated 10 production callers of `normalizeInstallDir`/`resolveInstallDir` to pass `agentDirNames: AgentRegistry.getInstance().getAgentDirNames()`:
  - `config.ts`, `nori-skillsets.ts`, `install.ts`, `init.ts`, `switchSkillset.ts`, `skillDownload.ts`, `external.ts`, `registryInstall.ts`, `registryDownload.ts`, `installLocation.ts`
- Added `AgentRegistry` import to `installLocation.ts` and `registryDownload.ts` (previously did not import it)
- Updated test mocks in `config.test.ts` and `registryInstall.test.ts` to include `getAgentDirNames`
- Added 4 new tests in `path.test.ts` for parameterized suffix stripping behavior
- Added 2 new tests in `skillsetMetadata.test.ts` for custom config file name detection
- Updated docs.md files

### Commit 10: Broadcast install and switch operations to all defaultAgents

**Refactor C progress:** Config command and interactive switchSkillsetFlow now broadcast operations to all agents in `defaultAgents` instead of operating on a single agent. This fulfills the spec requirement that "the activeSkillset should be applied to all agents in the defaultAgent list."

Changes:
- `switchSkillsetFlow` in `src/cli/prompts/flows/switchSkillset.ts` now builds an `agentNames` array from all resolved agents and loops `onExecuteSwitch` over every agent in Step 4, not just `agents[0]`
- `config.ts` installDir-change branch now resolves all agents from the new `result.defaultAgents` and calls `installMain` once per agent with the `agent` parameter
- `config.ts` added-agents branch now loops over `addedAgents` and calls `installMain` once per added agent with the `agent` parameter
- Added test in `switchSkillset.test.ts` (flow): "should call onExecuteSwitch for every resolved agent"
- Added 2 tests in `config.test.ts`: per-agent install on installDir change, per-added-agent install on agents change
- Added test in `switchSkillset.test.ts` (command): verifies interactive callback calls `switchSkillset` and `installMain` for given agent
- Updated 2 docs.md files

### Commit 11: Broadcast init, change detection, and config capture to all defaultAgents

**Refactor C progress:** Extended the remaining single-agent command paths to broadcast operations to all default agents. The init command, switchSkillset config capture, and switchSkillsetFlow change detection now operate on all agents.

Changes:
- `init.ts` now loops over all `defaultAgentNames` for `markInstall` and `captureExistingConfig` in both interactive and non-interactive paths (detection still uses first agent to check if *any* agent is set up)
- `switchSkillset.ts` `onCaptureConfig` callback now loops over all agents from `getDefaultAgents()` calling `captureExistingConfig` on each, instead of only `captureAgentNames[0]`
- `switchSkillsetFlow` in `switchSkillset.ts` (flow) now calls `onPrepareSwitchInfo` for ALL resolved agents and aggregates their `ManifestDiff` results — if any agent reports changes, the user sees the combined diff
- `switchSkillsetFlow` confirmation note now shows all agent names (comma-separated for multiple agents)
- Deduplicated `agentDisplay` variable in switchSkillsetFlow (was computed twice)
- Added 2 tests in `init.test.ts` for multi-agent broadcasting
- Added 1 test in `switchSkillset.test.ts` for onCaptureConfig broadcasting to all agents
- Added 3 tests in `switchSkillset.test.ts` (flow) for multi-agent change detection and aggregation
- Updated 3 docs.md files

### Commit 12: Agent-agnostic init flow and manifest defaults

**Refactor A progress:** Removed the last hardcoded Claude-specific strings from shared production code. The init flow and manifest module are now fully agent-agnostic.

Changes:
- Added `configFileName: string` to `ExistingConfig` type in `agentRegistry.ts`
- `detectExistingConfig` in `existingConfigCapture.ts` returns `configFileName: "CLAUDE.md"`
- `buildExistingConfigSummary` in `init.ts` uses `config.configFileName` instead of hardcoded `"CLAUDE.md"`
- Ancestor warning text changed from `"Claude Code loads CLAUDE.md files..."` to `"Some AI coding agents load config files..."`
- `MANAGED_FILES` and `MANAGED_DIRS` defaults in `manifest.ts` changed to empty arrays
- Legacy `removeManagedFiles` call in `claude-code/agent.ts` now passes explicit `managedDirs`
- Updated manifest tests to pass explicit managed files/dirs constants
- Added 3 new tests in `init.test.ts` for agent-agnostic display strings
- Updated 4 docs.md files

## Remaining Work

### Refactor A (continued): Further agent decoupling
- `AgentName` type is a literal `"claude-code" | "cursor-agent"` string union (widened from original single-agent type)
- Help text in `noriSkillsetsCommands.ts` still mentions "claude-code" as an example — this is documentation, not logic
- JSDoc comments in `agentRegistry.ts`, `config.ts`, and `watch/paths.ts` mention "claude-code" as examples — documentation only
- `parseSkillset()` default `configFileName` is still `"CLAUDE.md"` — this is the skillset source format, not agent-specific
- `looksLikeSkillset()` and `ensureNoriJson()` defaults still reference `["CLAUDE.md"]` — same reason (skillset source format)

### Refactor B (continued): Further Skillset type usage
- The `Skillset` type could be extended to include more parsed metadata as needed

### Refactor C (continued): Multi-agent support improvements
- `detectLocalChanges`, `removeSkillset`, and `installSkillset` are on the Agent interface (Commits 5-6)
- Config command now handles removed agent cleanup when `defaultAgents` shrinks (Commit 8)
- Config command broadcasts install to all agents on installDir change and added agents (Commit 10)
- Interactive `switchSkillsetFlow` broadcasts switch, change detection, and capture to all agents (Commits 10-11)
- `init.ts` broadcasts `markInstall` and `captureExistingConfig` to all agents (Commit 11)
- Interactive `switchSkillset` `onCaptureConfig` broadcasts to all agents (Commit 11)
- Non-interactive `switchSkillset` already broadcasted to all agents (pre-existing)
- `registryInstall` already broadcasted to all agents (pre-existing)
- `watch` command still only watches a single agent's projects directory — watching multiple dirs would be an architectural change
