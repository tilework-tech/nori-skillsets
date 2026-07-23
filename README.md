# Nori Skillsets Client

[![CI](https://github.com/tilework-tech/nori-skillsets/actions/workflows/ci.yml/badge.svg)](https://github.com/tilework-tech/nori-skillsets/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/nori-skillsets)](https://www.npmjs.com/package/nori-skillsets)
[![npm license](https://img.shields.io/npm/l/nori-skillsets)](https://www.npmjs.com/package/nori-skillsets)
[![npm downloads](https://img.shields.io/npm/dm/nori-skillsets)](https://www.npmjs.com/package/nori-skillsets)

**CLI Client for installing and managing Nori Skillsets**

The Nori Skillsets Client connects you to [noriskillsets.dev](https://noriskillsets.dev/), a registry of verified agent Skills and packaged agent configurations. Install complete Skillsets or individual Skills that have been reviewed for effectiveness, clarity, and proper implementation.

The client supports a wide range of coding agents (Claude Code, Cursor, Codex, Gemini CLI, GitHub Copilot, OpenCode, Goose, Kilo, Kimi CLI, Pi, OpenClaw, Droid). Each agent receives a translation of the same skillset into the format it expects on disk.

For complete documentation and to browse available Skillsets, visit:
- **Skillsets Registry**: [noriskillsets.dev](https://noriskillsets.dev/)
- **Documentation**: [noriskillsets.dev/docs](https://noriskillsets.dev/docs/building-a-skillset)

## What is a Skillset?

A Skillset is a complete, unified configuration that defines how your coding agent behaves. Skillsets can include:

- **Skills**: Step-by-step instructions that encode specific agent behaviors (TDD, debugging, code review, git workflows)
- **AGENTS.md / CLAUDE.md**: Custom instructions and workflow preferences that guide the agent
- **Subagents**: Specialized agents for specific tasks (codebase search, documentation, research)
- **Slash Commands**: Quick actions that invoke Skills and workflows
- **MCP servers**: Bundled Model Context Protocol server configs translated into each agent's expected format at install time (e.g., `.mcp.json` for Claude, `config.toml` for Codex, `settings.json` for Gemini, `mcp.json` for Cursor)

## Installation

Install the client:

```bash
npm install -g nori-skillsets
```

Run init to set up a skillsets folder at cwd/.nori/profiles and capture your existing configs.
Note that this will set up in the folder that you run the command in, allowing you to scope skillsets by project.

```bash
nori-skillsets init
```

Download a skillset from noriskillsets.dev.

```bash
nori-skillsets download senior-swe
```

Switch to using the new skillset.

```bash
nori-skillsets switch senior-swe
```

Install and activate a skillset directly from a Git repository:

```bash
sks install my-skillset --from git@github.com:myorg/skillsets.git
```

The repository must expose an explicit
`refs/heads/skillsets/my-skillset` branch with an exact lowercase root
`nori.json` regular file whose manifest has `"name": "my-skillset"` and
`"type": "skillset"`; a tag with the same name does not satisfy the branch
requirement. Git 2.29 or newer is required. The command requests that branch's
tip with `ls-remote`, initializes
`~/.nori/profiles/personal/my-skillset/` as a repository, and fetches only the
exact branch ref without tags, a `FETCH_HEAD` write, or a client-imposed depth
limit. The fetch accepts a shallow source's advertised boundary, but a normal
source retains its complete branch history. An unpinned install remains attached
to the fetched current tip. Historical pin resolution rejects the source if Git
reports incomplete shallow history. To install an exact historical commit, pass
its full SHA-1 or SHA-256 object ID:

```bash
sks install my-skillset --from git@github.com:myorg/skillsets.git \
  --pin 0123456789abcdef0123456789abcdef01234567
```

Pinned installs accept only 40- or 64-character hexadecimal commit IDs and
require the supplied value to equal Git's fully resolved object ID. This also
rejects a 40-character abbreviation in a SHA-256 repository. The commit must
be reachable through the complete parent history of the observed
`skillsets/my-skillset` branch tip. A pinned checkout has detached `HEAD`,
validates the selected historical tree, and reports the resolved SHA. Only
pinned installs verify that the repository is non-shallow, because they must
prove complete ancestry.

Interactive installs ask you to trust the source; unattended installs must add
`--trust-source`. Unattended Git processes set `GIT_TERMINAL_PROMPT=0` and use
OpenSSH batch mode, so Git, SSH host-key confirmation, and SSH
password/passphrase challenges fail instead of prompting. `GIT_SSH` executables,
arbitrary SSH command wrappers, and clients that do not accept OpenSSH options
are outside this feature's compatibility contract. Credential-bearing URL
components are redacted from trust prompts and Git errors; sensitive query keys
are recognized after percent-decoding and may be separated by `&` or `;`:

```bash
sks install my-skillset --from git@github.com:myorg/skillsets.git --trust-source
```

Git-backed installs do not automatically fetch later commits. Run the command
only for a new local name: an existing `personal/my-skillset` is never
overwritten. Git remote-helper syntax and URL schemes outside `http`, `https`,
`ssh`, `git`, `git+ssh`, and `file` are rejected before the trust prompt; local
paths and SCP-style SSH remotes remain supported. Git commands have a bounded
timeout, and acquisition avoids writing the credential-bearing fetch URL to
`FETCH_HEAD`. Remote credentials and terminal control characters are sanitized
in output. Relative local remotes are resolved once to an absolute path for
acquisition and ordinary stored origin metadata. That stored `origin` removes
passwords, every query parameter and fragment, and HTTP(S)/file usernames. It is
command-local credential hygiene, not durable Nori source, update, trust, or
authentication metadata. Prefer Git credential helpers, environment-based
authentication, or SSH agents instead of literal credentials in a remote URL.

Before reading the manifest, Git-backed installs reject tracked symbolic links,
submodules, every path whose first root component normalizes to the Registry
`.nori-version` name, and every non-exact or descendant path whose first root
component normalizes to `nori.json`. Normalization includes compatibility
normalization, case folding, and removal of the code points Git ignores on HFS
filesystems, so reserved directory aliases such as `.NORI-VERSION/...` or
`NORI.JSON/...` are rejected too. The sole accepted manifest authority is the
exact lowercase root regular file `nori.json`. Git installs never fall back to
the Registry and do not persist Nori-specific source provenance or trust state.

Activation targets all configured agents, then commits `personal/my-skillset`
as the global active identity only after every agent succeeds. Each agent's
`.nori-managed` marker is written only after that agent activates successfully.
Managed files and markers written for earlier agents are not rolled back if a
later activation fails. A failed activation or final config commit retains the
checkout and reports a POSIX-shell-quoted recovery command that preserves the
effective install-directory and single-agent scope. Console, stdout, and stderr
from nested activation are buffered until overall success and discarded on
failure; `--silent` also discards them after success. This buffering and delayed
identity commit are not shared transactional activation.

## How Skillsets Work

Skillsets are stored in `~/.nori/profiles/` as your library of available configurations. When you switch to a Skillset, the client writes its contents into the relevant locations for each configured agent (e.g., `.claude/` for Claude Code, `.cursor/` for Cursor, `.codex/` for Codex, `.gemini/` for Gemini CLI). Configure which agents to target with `nori-skillsets config`.

**Example local structure after authoring a skillset created by `sks new` (with no configured default organization):**

`sks new` initially creates only `.git/`, `.gitignore`, and `nori.json`; the
remaining entries are added as the skillset is authored.

```
~/.nori/profiles/personal/my-skillset/
├── .git/                   # Independent local version history
├── .gitignore              # Nori-local state excluded from commits
├── AGENTS.md              # Custom instructions (CLAUDE.md also supported)
├── nori.json              # Skillset manifest (name, version, dependencies, requiredEnv)
├── skills/                # Skill definitions
│   ├── my-skill/
│   │   └── SKILL.md
│   └── another-skill/
│       └── SKILL.md
├── subagents/             # Subagent configurations
├── slashcommands/         # Custom slash commands
└── mcp/                   # Canonical MCP server configs (one JSON file per server)
```

When you activate a Skillset:
1. The client cleans any existing configuration in each configured agent's directory
2. Translates the skillset into the format each agent expects and writes it to the corresponding agent directory
3. Each agent reads the new configuration in its next session

This separation lets you maintain multiple Skillsets, target multiple agents at once, and switch between them without losing any configuration.

## Requirements

- Node.js 22 or higher
- Git available on `PATH` for `sks new`, `sks fork`, and `install --from`; SHA-256 repository support depends on the installed Git build
- At least one supported coding agent CLI installed (Claude Code, Cursor, Codex, Gemini CLI, etc.)
- Mac or Linux operating system

## Creating custom skillsets or making changes to skillsets

1. Create a local, Git-backed skillset. Supplying the name skips the metadata
   wizard; run `sks new` without a name to use the wizard instead.

   ```bash
   sks new my-skillset
   ```

   This initializes a repository without creating a commit, remote, or
   authentication requirement. Git init templates are disabled so ambient
   template configuration cannot populate the new repository or add a remote.

2. Open the skillset and add an `AGENTS.md` file with your custom instructions:

   ```bash
   sks edit my-skillset
   ```

   ```markdown
   # My Custom Skillset

   Add your workflow preferences here:
   - Testing requirements
   - Git automation rules
   - Code style guidelines
   - Any repeating instructions
   ```

3. Activate your skillset:
   ```bash
   nori-skillsets switch my-skillset
   ```

4. Version it with normal Git commands. With no configured default
   organization, a bare name is created in the `personal/` namespace:

   ```bash
   cd ~/.nori/profiles/personal/my-skillset
   git status
   ```

   When `defaultOrg` is configured, use
   `~/.nori/profiles/<org>/my-skillset` instead.

To customize an existing skillset without retaining its source history or
authority, fork it under a new name:

```bash
sks fork existing-skillset my-skillset
```

The fork contains the authored package content with its manifest renamed for
the destination. It preserves authored metadata and existing `.gitignore`
rules, but removes Registrar provenance, Nori-local state, caches, generated
agent output, and the source repository's Git history. The destination is a new
Git repository with no commit or remote; committing and publishing remain
explicit later steps.

For v1, registered provider output files and directories are treated as wholly
generated and omitted by path. Authored sibling paths in shared directories are
preserved; `fork` does not attempt to reverse-render mixed generated files.

The source may itself be linked into the profile library, but package content
inside it must be self-contained. Forking rejects interior symbolic links,
submodules, and nested repositories. It never overwrites an existing
destination, never mutates the source, and removes only the newly created
destination if the operation fails.

Git-backed skillsets use Git as their source authority. Mutating Registrar
commands therefore refuse to download into or upload from a Git-governed
location. This includes whole-skillset and individual-skill uploads, plus new
download destinations beneath an existing Git working tree. Publish those
sources through Git instead; Registrar-managed packages remain on Registrar.
Read-only version listing and upload dry runs remain available.

Manual changes made to an agent's installed directory (e.g., `.claude/`, `.cursor/`, `.codex/`) will be removed when switching skillsets. Manual changes should be made in the `~/.nori/profiles/personal/<skillset-name>/` directory instead (or the corresponding `~/.nori/profiles/<org>/<skillset-name>/` directory for an organization skillset).

## Private Skillsets for Teams

Teams can set up private registries to share custom Skillsets across the organization. With private registries:

- Full access control - only your organization can view and install
- Package working configurations and publish internally
- Teammates install the exact setup that proved successful
- Optional Skills Review service: professional evaluation before publication

Contact us at [noriagentic.com](https://noriagentic.com) to set up a private registry for your team.

## Resources

- **Skillsets Registry**: [noriskillsets.dev](https://noriskillsets.dev/)
- **Documentation**: [noriskillsets.dev/docs](https://noriskillsets.dev/docs/building-a-skillset)
- **GitHub**: [github.com/tilework-tech/nori-skillsets](https://github.com/tilework-tech/nori-skillsets)
- **npm**: [npmjs.com/package/nori-skillsets](https://www.npmjs.com/package/nori-skillsets)
- **Contact**: [noriagentic.com](https://noriagentic.com)
