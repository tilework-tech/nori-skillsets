# Noridoc: git-install

Path: @/src/cli/commands/git-install

### Overview

- Implements the consumer-side Git source for `sks install <slug> --from <remote>`.
- Treats a repository as a store of complete skillsets whose branch names follow `skillsets/<slug>`; users provide the remote and skillset name rather than internal Git coordinates.
- Acquires and validates a checkout before handing the canonical local identity `personal/<slug>` to the shared activation pipeline.

### How it fits into the larger codebase

- The central command registration layer dispatches here only when `--from` is present. An install without `--from` continues through the existing Registrar path, and failures in this path are returned directly rather than triggering a Registrar fallback.
- Git acquisition is deliberately independent of Registrar APIs and dependency resolution. A Git-backed package must already contain everything its manifest declares; materialized dependency entries are valid, while unresolved declarations fail validation.
- Successful acquisition produces a normal local skillset directory, so activation reuses the same agent registry, install-directory resolution, switching, and installation features as other local skillsets.
- The source checkout remains a Git working tree under the `personal/` storage bucket. Its repository-local configuration is the durable source of Git provenance for later follow/update behavior.

### Core Implementation

- The requested slug deterministically selects `refs/heads/skillsets/<slug>` and the destination `personal/<slug>`. The manifest name must exactly equal the requested slug; the remote cannot choose or override the local identity.
- Acquisition uses native Git with argument-array process execution. It clones into a sibling temporary directory, validates the checkout, writes provenance, and renames it into place only after every pre-activation check succeeds.
- An unpinned install resolves the current branch tip and records follow mode. `--pin <sha>` accepts only a commit SHA, verifies that the commit is an ancestor of the derived branch tip, and checks out that exact revision in pinned mode.
- Source approval happens before acquisition. Interactive installs require affirmative confirmation; non-interactive installs require `--trust-source`. Embedded URL credentials are rejected so secrets are not copied into checkout metadata; authentication is delegated to standard Git credential helpers or SSH agents.
- Repository-local Git configuration records the normalized remote, derived ref, source mode, resolved commit, and trust decision. Pinned installs also retain the requested pin. This metadata travels with the checkout but does not alter user-global Git configuration.
- Activation snapshots the existing Nori config before acquiring the source. If activation fails after acquisition, it removes newly managed agent output, deletes the new checkout, and restores the prior config state.

### Things to Know

- Local-name collisions fail closed: an existing `personal/<slug>` path is never overwritten or reused, including when it is a symlink or an incomplete checkout.
- Checkout validation requires a skillset manifest with an exact name match and rejects unresolved dependency declarations, symbolic links, submodules, and Registrar `.nori-version` provenance. This keeps the installed package self-contained, prevents its contents from escaping the checkout boundary, and prevents later switches from reinterpreting it as Registrar-backed.
- Validation and Git failures leave the destination absent because all work occurs in a temporary sibling directory. A failed activation similarly removes the acquired checkout and restores config, so it cannot leave a half-installed Git source selected as active.
- A pin is a historical selection within the named skillset branch, not an arbitrary repository commit. Reachability validation prevents another branch's commit from being installed under the requested skillset identity.
- The checkout-local provenance is separate from Registry `.nori-version` provenance. Git installs do not claim a Registrar source and are not eligible for Registrar fallback behavior.

Created and maintained by Nori.
