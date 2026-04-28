# Noridoc: import-mcp

Path: @/src/cli/commands/import-mcp

### Overview

- The `import-mcp` CLI subcommand. Scans well-known on-disk MCP server config files (Claude, Codex, Gemini, Cursor, VS Code) and ingests them into a target skillset's `mcp/` directory as canonical JSON files.
- Sanitizes literal-looking secrets to `${env:VAR}` placeholders before writing, and auto-derives a `requiredEnv` list into the skillset's `nori.json`.
- Inverse of the install-time MCP emit path in @/src/cli/features/shared/mcpLoader.ts: this command parses each agent's native format and normalizes back to the canonical schema, while install writes the canonical schema out to each agent's native format.

### How it fits into the larger codebase

- `importMcpMain` is the single entry point. It is registered as a Commander command via `registerNoriSkillsetsImportMcpCommand` in @/src/cli/commands/noriSkillsetsCommands.ts and wired into the CLI in @/src/cli/nori-skillsets.ts.
- Parsing is delegated to `parseAgentConfig` from @/src/cli/features/shared/mcpEmitter.ts. The same parser is used to normalize across all supported on-disk formats (`claude-mcp-json`, `codex-toml`, `gemini-json`, `cursor-json`, `vscode-json`).
- Skillset discovery uses `listSkillsets()` and `getNoriSkillsetsDir()` from @/src/norijson/skillset.ts. Metadata I/O uses `readSkillsetMetadata` / `writeSkillsetMetadata` from @/src/norijson/nori.ts.
- The auto-derived `requiredEnv` array written into `nori.json` is the same field consumed by `checkRequiredEnv` in @/src/cli/features/envCheck.ts at install time, closing the loop: imported servers get their env names surfaced to the user the next time the skillset is installed.

### Core Implementation

- **Scan candidate list**: A static set of (filePath, format) pairs covering the project-scope and user-scope locations for each supported agent. Both `cwd`-relative and `home`-relative paths are scanned for agents that support both scopes.
- **Per-file collection**: For each candidate, the file is read if it exists and passed through `parseAgentConfig`. Parse failures are logged via `log.warn` and the file is skipped (the command does not abort on a single bad config).
- **Sanitization**: Each server's `env` map is checked. Values that look like literal tokens (regex `^[A-Za-z0-9_\-+/=]{20,}$` and not already a `$`-prefixed placeholder) are rewritten to `${env:KEY}` where `KEY` is the env var name; the keys that were rewritten are reported via `log.warn` so the user can review before publishing the skillset.
- **Dedup by name**: When the same server name appears in multiple sources, the first occurrence wins and a warning is emitted naming the source that was kept.
- **Write canonical JSON**: One file per server at `~/.nori/profiles/<skillset>/mcp/<server-name>.json`. The directory is created if needed.
- **Auto-derive `requiredEnv`**: `findEnvPlaceholders` scans the imported set for `${env:VAR}` references in `env`, `headers`, and bearer `auth.tokenEnv`. `mergeRequiredEnv` keeps existing entries (preserving user-authored object form with `description`/`url`) and appends any newly discovered names as `{ name }` objects.
- **Interactive vs non-interactive**: If no skillset name is passed, interactive mode presents a `select()` prompt populated from `listSkillsets()`. Non-interactive mode returns a `CommandStatus` failure if the argument is missing.

### Things to Know

- The literal-secret heuristic (`TOKEN_PATTERN`) is conservative: 20+ chars of `[A-Za-z0-9_\-+/=]`. Short literal env values (like `production` or `1`) are left alone. Anything starting with `$` or `${` is treated as already-symbolic and never rewritten.
- OAuth-typed servers do not flow through static credentials. The emitter at install time omits any `Authorization` header for `auth: "oauth"`, so no token sanitization is required for that path.
- Codex parsing uses regex-based TOML extraction targeting only the `[mcp_servers.<name>]` and `[mcp_servers.<name>.env]` table shapes that this codebase emits. It is not a general TOML parser; configs hand-edited to use unusual formatting may be skipped.
- Re-running `import-mcp` against the same skillset is idempotent for `requiredEnv` (existing entries are preserved by name) but will overwrite each `mcp/<name>.json` with the latest on-disk state.
- The command does not write to `.nori-config.json` or trigger any agent install; it only stages canonical files inside the skillset. Users still need to switch to (or reinstall) the skillset for the bundled MCP servers to take effect on each agent.

Created and maintained by Nori.
