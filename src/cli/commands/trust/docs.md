# Noridoc: trust + primary remote

Path: @/src/cli/commands/trust

### Overview

Feature 4 adds two related capabilities:

- **Primary remote** — `sks config --primary-remote <remote>` stores a Git
  remote so a bare-name `sks install <slug>` resolves to `skillsets/<slug>` on
  that remote instead of the Registry. The Registry stays the default until a
  primary remote is set; an explicit `sks install <slug> --from <remote>` always
  overrides it; once configured, bare-name installs are Git-only (no Registry
  fallback), and `--pin` still requires an explicit `--from`.
- **Durable trust** — `sks trust list` / `sks trust revoke <remote> <slug>`
  manage a persisted trust store so a Git source approved once is not re-prompted.

### The trust store

- `src/cli/features/trustStore.ts` backs `~/.nori/trust.json`
  (`{ version, entries: [{ remote, branch, addedAt }] }`). Trust is keyed by the
  **canonicalized remote** (`canonicalizeRemoteForTrust` in gitPackage: scp-form
  ↔ `ssh://` collapse, credentials/`.git`/trailing-slash stripped, host
  lowercased — different transports stay distinct) plus the derived branch
  `skillsets/<slug>`. This is **source-authorization** trust, not content
  pinning (content pinning is `install --pin`).
- Reads tolerate a missing/corrupt file (empty store); writes are atomic and
  serialized under `withInstallLock` at the call sites.
- Per-user only in v1 (the entry shape leaves room for a later org layer).

### How trust integrates with `install --from`

In `gitInstall.ts`, the trust decision consults the store: if the
`(canonical remote, branch)` is already trusted, the prompt/`--trust-source`
gate is skipped; otherwise the existing gate runs (interactive confirm, or
`--trust-source` required non-interactively) and, on approval, the pair is
persisted. Changing the remote or the slug (→ branch) is a key miss and
re-prompts. `sks trust revoke <remote> <slug>` removes the entry (matching any
URL variant of the remote via canonicalization), after which the next install
re-prompts.

### Things to Know

- `trust list` prints the canonical (credential-free) remote and branch; an
  empty store reports "No trusted Git sources."
- `trust revoke` reports whether an entry was actually removed.
- Approval persists whether it came from an interactive confirm or
  `--trust-source` (TOFU).

Created and maintained by Nori.
