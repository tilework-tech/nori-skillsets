# Noridoc: git-install

Path: @/src/cli/commands/git-install

### Overview

- Implements the consumer-side Git source for `sks install <slug> --from <remote>`.
- Derives the source branch `skillsets/<slug>` from the requested local name, so users provide only the remote and slug.
- Clones and validates the checkout in one command-level flow before handing the canonical local identity `personal/<slug>` to the shared activation pipeline.

### How it fits into the larger codebase

- The central command registration layer dispatches here only when `--from` is present. An install without `--from` continues through the existing Registrar path, and failures in this path are returned directly rather than triggering a Registrar fallback.
- Git acquisition is deliberately independent of Registrar APIs. It does not download dependencies or apply a dependency-materialization heuristic.
- Successful acquisition produces a normal local skillset directory, so activation reuses the same agent registry, install-directory resolution, and shared non-interactive installer as other local skillsets.
- The source checkout remains a Git working tree under the `personal/` storage bucket. This feature does not add custom provenance, durable trust state, or update behavior.

### Core Implementation

- The requested slug deterministically selects `skillsets/<slug>` and the destination `personal/<slug>`. The root `nori.json` must have exactly that slug as its `name` and `skillset` as its `type`; the remote cannot choose or override the local identity.
- Source approval happens before acquisition. Interactive installs require affirmative confirmation, while non-interactive and silent installs require `--trust-source`. Approval applies to this command invocation only and is not persisted as a durable trust decision.
- Acquisition uses native Git with argument-array process execution. It atomically reserves the final destination directory, then clones the current branch tip directly into that reserved directory as a normal Git working tree. Clone depth is deliberately unspecified; historical retrieval belongs to the later pinning feature.
- Validation inspects tracked Git entries and rejects symbolic links, submodules, and a root `.nori-version` file. Clone and validation errors remove the reserved destination, leaving no partial local skillset.
- After acquisition, activation targets every configured default agent by calling the shared non-interactive installer directly. This feature does not introduce a reusable Git acquisition layer; the later pinning feature owns historical retrieval and may extract shared acquisition once it creates a second consumer.

### Things to Know

- Local-name collisions fail closed: an existing `personal/<slug>` path is never overwritten or reused, including when it is a symlink or an incomplete checkout.
- The clone is a one-time snapshot of the branch tip at installation time. There is no `--pin` option and no automatic fetch, fast-forward, or session-restart update behavior in this slice.
- Validation intentionally stops at manifest identity/type and tracked-entry safety. Dependency declarations are not resolved through the Registrar and are not checked for matching materialized content by this command.
- Acquisition and validation failures clean up the checkout. Once activation begins, normal installation semantics apply: there is no Git-specific transaction that removes the checkout, restores prior config, or rolls back agent output after an activation failure.
- The checkout contains Git's ordinary origin and branch metadata but no Nori-specific source provenance or durable trust marker. It never carries Registrar `.nori-version` provenance and is never eligible for Registrar fallback behavior.
- Durable Git source metadata and an update adapter belong to the later update feature rather than this initial install slice.

Created and maintained by Nori.
