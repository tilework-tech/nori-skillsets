# Noridoc: cursor-agent

Path: @/src/cli/features/cursor-agent

### Overview

The Cursor agent implementation. This directory contains the `Agent` interface implementation for Cursor IDE, along with Cursor-specific path utilities and the `CursorLoaderRegistry` that orchestrates feature installation into the `.cursor/` directory and the project root (for `AGENTS.md`). The architecture mirrors @/src/cli/features/claude-code/ but maps skillset components to Cursor's configuration format.

### How it fits into the larger codebase

- `agent.ts` exports `cursorAgent`, which is registered in `@/src/cli/features/agentRegistry.ts` alongside `claudeCodeAgent`. Both agents share the same `activeSkillset` in the Config -- switching skillsets applies to all agents.
- CLI commands interact with this agent through the `Agent` interface from @/src/cli/features/agentRegistry.ts for install detection, skillset switching, and installation.
- The `CursorLoaderRegistry` uses the shared `configLoader` from @/src/cli/features/config/loader.ts as its first loader, ensuring config is persisted before profile-dependent loaders run.
- All profile sub-loaders read from the same `~/.nori/profiles/` directory as the Claude Code agent, using `parseSkillset()` from @/src/cli/features/skillset.ts. The skillset's `CLAUDE.md` is read as the source config file and its content is written to `AGENTS.md` for Cursor.
- Template substitution via `substituteTemplatePaths()` from @/src/cli/features/template.ts uses the `.cursor` directory as `installDir` so `{{skills_dir}}` resolves to `.cursor/skills/`.
- Per-agent manifest is stored at `~/.nori/manifests/cursor-agent.json` via the shared manifest infrastructure in @/src/cli/features/manifest.ts.
- The `description` property (e.g., "Instructions, skills, subagents, commands") is surfaced as a hint in the config multiselect UI in @/src/cli/prompts/flows/config.ts.

### Core Implementation

The `cursorAgent` object in `agent.ts` implements the `Agent` interface with these Cursor-specific mappings:

| Skillset Component | Claude Code Target | Cursor Target |
|---|---|---|
| `CLAUDE.md` | `.claude/CLAUDE.md` | `{installDir}/AGENTS.md` (project root) |
| `skills/` | `.claude/skills/` | `.cursor/skills/` |
| `slashcommands/` | `.claude/commands/` | `.cursor/commands/` |
| `subagents/` | `.claude/agents/` | `.cursor/agents/` |

**Loader pipeline** (`loaderRegistry.ts`): The `CursorLoaderRegistry` singleton registers two top-level loaders in order: `configLoader` then `cursorProfilesLoader`. The profiles loader (`skillsets/loader.ts`) parses the active skillset and delegates to the `CursorProfileLoaderRegistry` (`skillsets/skillsetLoaderRegistry.ts`), which runs four sub-loaders in order: `skills` -> `agentsmd` -> `slashcommands` -> `subagents`. Skills must install before agentsmd because the AGENTS.md generator reads installed skill paths to embed a skills discovery section.

**AGENTS.md generation** (`skillsets/agentsmd/loader.ts`): Reads the skillset's `CLAUDE.md` (via `skillset.configFilePath`), strips any existing managed block markers, applies template substitution with the `.cursor` install directory, appends a generated skills list section (by scanning SKILL.md files for front matter metadata), and writes the result into a `# BEGIN NORI-AI MANAGED BLOCK` / `# END NORI-AI MANAGED BLOCK` section in `{installDir}/AGENTS.md` at the project root. If no config file exists, clears the managed block.

**Path helpers** (`paths.ts`): Provides `getCursorDir`, `getCursorAgentsMdFile`, `getCursorSkillsDir`, `getCursorCommandsDir`, and `getCursorAgentsDir`. Most paths derive from `{installDir}/.cursor/`, but `getCursorAgentsMdFile` returns `{installDir}/AGENTS.md` (project root) because Cursor IDE reads `AGENTS.md` from the project root, not from inside `.cursor/`.

**Differences from Claude Code agent**: The cursor agent does not implement `factoryReset`, `detectExistingConfig`, `captureExistingConfig`, `getProjectDirName`, `getProjectsDir`, or `findArtifacts` (these are optional `Agent` interface methods). It also has no hooks, statusline, or announcements loaders -- those are Claude Code specific features.

### Things to Know

- **AGENTS.md lives at project root, not inside `.cursor/`**: Cursor IDE reads `AGENTS.md` from the project root. Because this file lives outside the `.cursor/` agent directory, it cannot be tracked by the standard manifest system (which tracks files relative to `agentDir`). Instead, `getManagedFiles()` returns `[]`, and the agent explicitly handles AGENTS.md in three places: `installSkillset` hashes and stores it in the manifest under the key `"AGENTS.md"`, `detectLocalChanges` compares the current AGENTS.md hash against the manifest entry, and `removeSkillset` deletes AGENTS.md via `fs.rm`.
- The `cursorProfilesLoader` in `skillsets/loader.ts` parses the skillset using `configFileName: "CLAUDE.md"` (not `"AGENTS.md"`), because the source skillset template always contains a `CLAUDE.md`. The mapping to `AGENTS.md` happens at write time in the agentsmd loader.
- Installation is detected solely via the `.nori-managed` marker file in `.cursor/` -- there is no backwards-compatible content-sniffing fallback like the Claude Code agent has.
- The `switchSkillset` method preserves the persisted `installDir` from the existing config rather than accepting the `installDir` argument, matching the Claude Code agent's behavior where only `sks config installDir <path>` changes the persisted install directory.
- **`switchSkillset` must explicitly pass through all config fields to `saveConfig()`**: The `saveConfig()` function in @/src/cli/config.ts only persists fields that are explicitly provided. `switchSkillset` reads the current config and passes every field back to `saveConfig()` along with the new `activeSkillset`. If a field is omitted, it is silently dropped from the config file. This includes auth fields, `defaultAgents`, `garbageCollectTranscripts`, `transcriptDestination`, `autoupdate`, `version`, and `installDir`.

Created and maintained by Nori.
