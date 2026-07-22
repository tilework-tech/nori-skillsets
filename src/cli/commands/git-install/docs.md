# Noridoc: git-install

Path: @/src/cli/commands/git-install

### Overview

- Implements the consumer-side Git source for `sks install <slug> --from <remote>`, including optional historical selection with `--pin <full-sha>`.
- Derives the source branch `skillsets/<slug>` from the requested local name, so users provide only the remote and slug.
- Clones and validates the checkout in one command-level flow before handing the canonical local identity `personal/<slug>` to the shared activation pipeline.

### How it fits into the larger codebase

- The central command registration layer dispatches here only when `--from` is present. An install without `--from` continues through the existing Registrar path, and failures in this path are returned directly rather than triggering a Registrar fallback.
- Git acquisition is deliberately independent of Registrar APIs. It does not download dependencies or apply a dependency-materialization heuristic.
- Successful acquisition produces a normal local skillset directory, so activation reuses the same agent registry, install-directory resolution, and shared non-interactive installer as other local skillsets.
- The source checkout remains a Git working tree under the `personal/` storage bucket. This feature does not add custom provenance, durable trust state, update behavior, or activation rollback.

### Core Implementation

- The requested slug deterministically selects `skillsets/<slug>` and the destination `personal/<slug>`. The root `nori.json` must have exactly that slug as its `name` and `skillset` as its `type`; the remote cannot choose or override the local identity.
- Source approval happens before acquisition. Interactive installs require affirmative confirmation, while non-interactive and silent installs require `--trust-source`. Approval applies to this command invocation only and is not persisted as a durable trust decision.
- Acquisition uses native Git with argument-array process execution and removes inherited Git repository-routing variables while preserving ordinary Git authentication behavior. It atomically reserves the final destination directory, then performs a complete, non-shallow, single-branch clone into that reserved directory.
- Without `--pin`, acquisition checks out the observed branch tip with the branch attached. With `--pin`, cloning uses `--no-checkout`, accepts only a full 40-character SHA-1 or 64-character SHA-256 hexadecimal object ID, rejects shallow repositories, verifies that the object is a commit reachable from the observed branch tip through Git's complete all-parent history, and checks it out with detached `HEAD`.
- Validation inspects tracked Git entries and rejects symbolic links, submodules, and a root `.nori-version` file. Clone and validation errors remove the reserved destination, leaving no partial local skillset.
- Validation runs after commit selection, so a pinned install validates the selected historical tree rather than the branch tip. After acquisition, activation targets every configured default agent by calling the shared non-interactive installer directly.

### Things to Know

- Local-name collisions fail closed: an existing `personal/<slug>` path is never overwritten or reused, including when it is a symlink or an incomplete checkout.
- The checkout is a one-time snapshot at installation time. There is no automatic fetch, fast-forward, or session-restart update behavior. Detached `HEAD` is the only pin marker until a later feature adds durable source metadata.
- Successful pinned installs report the resolved full object ID. Abbreviated IDs, refs, tags, revision expressions, missing objects, non-commit objects, commits outside the selected branch's all-parent history, and sources whose complete history cannot be proven are rejected.
- Validation intentionally stops at manifest identity/type and tracked-entry safety. Dependency declarations are not resolved through the Registrar and are not checked for matching materialized content by this command.
- Acquisition and validation failures clean up the checkout. Once activation begins, normal installation semantics apply: there is no Git-specific transaction that removes the checkout, restores prior config, or rolls back agent output after an activation failure.
- The checkout contains Git's ordinary origin and branch metadata but no Nori-specific source provenance or durable trust marker. It never carries Registrar `.nori-version` provenance and is never eligible for Registrar fallback behavior.
- Durable Git source metadata and an update adapter belong to the later update feature rather than historical installation.

Created and maintained by Nori.
