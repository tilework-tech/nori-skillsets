# Skillsets Foundation Cleanup — Desired Structure & Behaviors

**Context.** Skillsets is pivoting: switching skill collections is no longer the
value prop (agents converged on well-known skill dirs and AGENTS.md). The next
features are (1) packaging/deploying collections of context, (2) durable
skillset backups to registry / git remotes / object stores, and (3) real
settings abstractions (hooks first; later models, permissions) — across many
more agents, with explicit support tiers. This spec defines the cleanup target:
structure and behavior invariants only. It adds no features.

## Target repo structure

```
src/
  packaging/       # THE package primitives: archive create/extract, gzip sniff,
                   # atomic dir swap, provenance (.nori-version), registry
                   # version lookup/format. Sole owner — no copies elsewhere.
  agents/          # ONE declarative table: per-agent paths, loader set,
                   # capabilities, supportTier ("supported" | "experimental").
                   # Per-agent code exists only where behavior truly differs
                   # (e.g. format emitters), never as copied boilerplate.
  core/            # Policy & orchestration: applySkillset, remove, capture,
                   # upload/download pipelines, conflict resolution, auth
                   # resolution. No prompts, no process.exit, no CLI parsing.
  cli/
    commands/      # Thin: parse args → call core → format output.
    prompts/flows/ # Thin: interactive wiring only; imports core, never the
                   # reverse. Contains zero policy.
  api/             # Registrar HTTP client.
  norijson/        # Manifest types + parsing (closed schema, no index signature).
  utils/
```

Structural rules:

- Dependency graph is acyclic: `commands`/`flows` → `core` → (`packaging` |
  `agents` | `api`) → `utils`. No dynamic `import()` to dodge cycles.
- Shared code contains zero `agent.name === "…"` conditionals; agent variance
  lives in the agents table or per-agent adapters.
- Any behavior reachable non-interactively is implemented in `core` and merely
  invoked by flows.

## Behavior invariants

### Packaging

- Exactly one module creates, extracts, and swaps package archives; every
  command uses it.
- Downloads verify content against the registry checksum; mismatch fails loudly.
- Updating any package (skill, subagent, skillset) is atomic: any failure
  leaves the previous contents fully intact.
- Recorded dependency versions match what is actually on disk (no `"*"`).
- Upload reads the source tree; it never restructures or mutates it without
  explicit consent.

### Install state

- "What is installed for agent A at directory D?" has one answer, computed by
  one code path, used by every command.
- Manifests are scoped per (agent, install directory); activity in one
  directory never produces phantom "local changes" in another. `skipManifest`
  no longer exists.
- Clearing multiple directories succeeds in any order; no step consumes state
  a later step needs.
- Read-only commands (`list`, `current`, `search`, …) never write to disk.

### Agents

- An agent is one table entry: paths, capabilities, support tier.
- Users can see each agent's tier and capabilities; help text derives from the
  table, not hardcoded strings.
- Adding an experimental agent is a table row plus tests — no copied files.

### Settings & hooks

- Nori only adds, updates, or removes settings entries it can identify as
  Nori-managed; user-authored hooks and settings keys survive install, switch,
  and uninstall untouched (hooks are merged, never replaced wholesale).
- Uninstall removes exactly what install added.
- Capture and backup operations are non-destructive reads.

## Refactor layers, sequenced toughest → easiest (1–3 PRs each)

Dead-code deletion (unused emitter formats, uncalled `subagentDiscovery`,
`bundle-skills` → `bundle-hooks` rename, stale comments) is folded
opportunistically into whichever layer touches those files.

| # | Layer | Scope | Difficulty | PRs |
|---|-------|-------|------------|-----|
| 1 | Layering & policy extraction | Move policy out of `prompts/flows` into `core` (upload resolution strategies, semver policy, `--resolve` path); dismember `registryUploadMain` / `uploadFlow` along auth/detect/package/upload/sync seams; extract `applySkillset` and delete the switch→install→init dynamic-import cycle. | **Hardest** | 3 |
| 2 | Packaging primitives | Create `src/packaging/`; migrate all five upload/download commands onto it; delete the per-type copies (~1.5–2k lines). | Medium | 2 |
| 3 | Install-state model | Re-key manifests by (agent, installDir) with legacy-path read fallback; delete `skipManifest` machinery and the clear-current ordering hack; single read-path reconciler for install state. | Medium | 1–2 |
| 4 | Agent table & tiers | Collapse 13 `agent.ts` files into the declarative table; add capabilities + supportTier; surface tiers in CLI help/listing; remove `agent.name` conditionals and `claudeCodeStatusLine`-style leaks from shared code. | Medium-easy | 1–2 |
| 5 | Non-destructive invariants | Hooks merge-not-clobber; capture stops deleting CLAUDE.md; reads don't write (`ensureNoriJson`); atomic skillset update; shasum verification; truthful dependency versions; upload no-mutate prompt; announcements disable flag. | Easy (many small, independent fixes) | 1–2 |

## Explicitly out of scope (decisions or pillar work, not cleanup)

- Relocating the `watch` transcript daemon (product decision).
- Retiring the `/api/skillsets` → `/api/profiles` 404 fallback (depends on
  deployed registrar versions).
- Retiring legacy `profile.json` / `skills.json` descriptors.
- Redesigning `settingsBackup` (pillar-3 design work).
- `config.ts` rewrite (demoted: ugly but contained; do only if auth work
  forces it).
