# Noridoc: cursor-agent

Path: @/src/cli/features/cursor-agent

### Overview

The Cursor agent configuration. This directory contains the `AgentConfig` data struct for Cursor IDE (`cursorConfig`), along with Cursor-specific path utilities. All behavioral operations (install, remove, detect) are handled by shared handler functions at `@/src/cli/features/shared/agentHandlers.ts` that accept `AgentConfig` as a parameter. The architecture mirrors @/src/cli/features/claude-code/ but maps skillset components to Cursor's configuration format.

### How it fits into the larger codebase

- `agent.ts` exports `cursorConfig`, which is registered in `@/src/cli/features/agentRegistry.ts` alongside `claudeCodeConfig`. Both agents share the same `activeSkillset` in the Config -- switching skillsets applies to all agents.
- CLI commands look up agent configs via `AgentRegistry` and pass them to shared handler functions from `@/cli/features/shared/agentHandlers.js` for operations like installation, removal, and detection.
- The shared `installSkillset` handler runs the config loader, then the shared profiles loader, then any agent-specific `extraLoaders`.
- All profile sub-loaders read from the same `~/.nori/profiles/` directory as the Claude Code agent, using `parseSkillset()` from @/src/cli/features/skillset.ts. The skillset's `CLAUDE.md` is read as the source config file and its content is written to `AGENTS.md` for Cursor.
- Template substitution via `substituteTemplatePaths()` from @/src/cli/features/template.ts uses the `.cursor` directory as `installDir` so `{{skills_dir}}` resolves to `.cursor/skills/`.
- Per-agent manifest is stored at `~/.nori/manifests/cursor-agent.json` via the shared manifest infrastructure in @/src/cli/features/manifest.ts.
- The `description` property (e.g., "Instructions, skills, subagents, commands") is surfaced as a hint in the config multiselect UI in @/src/cli/prompts/flows/config.ts.

### Core Implementation

The `cursorConfig` object in `agent.ts` provides data fields for Cursor-specific mappings:

| Skillset Component | Claude Code Target | Cursor Target |
|---|---|---|
| `CLAUDE.md` | `.claude/CLAUDE.md` | `.cursor/rules/AGENTS.md` |
| `skills/` | `.claude/skills/` | `.cursor/skills/` |
| `slashcommands/` | `.claude/commands/` | `.cursor/commands/` |
| `subagents/` | `.claude/agents/` | `.cursor/agents/` |

Key `AgentConfig` fields:
- `agentDirName`: ".cursor"
- `instructionFilePath`: "rules/AGENTS.md" (note: lives in a subdirectory)
- `configFileName`: "CLAUDE.md" (source file name in skillsets)
- `extraManagedDirs`: ["rules"] (so AGENTS.md at `.cursor/rules/AGENTS.md` is tracked by the manifest system)
- No `extraLoaders` (Cursor has no hooks, statusline, or announcements)
- No `transcriptDirectory`, `factoryReset`, `findArtifacts`, or `legacyMarkerDetection` fields

**Path helpers** (`paths.ts`): Provides `getCursorDir`, `getCursorAgentsMdFile`, `getCursorSkillsDir`, `getCursorCommandsDir`, and `getCursorAgentsDir`. All paths derive from `{installDir}/.cursor/`. `getCursorAgentsMdFile` returns `{installDir}/.cursor/rules/AGENTS.md`.

**Differences from Claude Code config**: The cursor config does not have `factoryReset`, `findArtifacts`, `legacyMarkerDetection`, `configurePermissions`, `transcriptDirectory`, `extraLoaders`, or `hasLegacyManifest` fields. These are optional `AgentConfig` fields that are Claude Code specific.

### Things to Know

- **AGENTS.md lives inside `.cursor/rules/`**: The `extraManagedDirs` field includes `"rules"`, so AGENTS.md at `.cursor/rules/AGENTS.md` is tracked by the standard manifest system automatically via the shared `getManagedDirs({ agentConfig })` handler. There is no special-case code for AGENTS.md in the shared handlers -- the manifest infrastructure handles hashing, change detection, and cleanup for all managed directories including `rules/`.
- The shared profile loaders parse the skillset using `configFileName: "CLAUDE.md"` (from `cursorConfig.configFileName`), because the source skillset template always contains a `CLAUDE.md`. The mapping to `AGENTS.md` happens at write time in the instruction file loader.
- Installation is detected solely via the `.nori-managed` marker file in `.cursor/` -- there is no `legacyMarkerDetection` function like the Claude Code config has.
- The shared `switchSkillset` handler only validates the skillset exists and logs -- it does not persist config. Config persistence (`updateConfig({ activeSkillset })`) is the command layer's responsibility, gated on install-dir provenance so that transient `--install-dir` CLI overrides do not write state to `.nori-config.json`.

Created and maintained by Nori.
