# Noridoc: git-install

Path: @/src/cli/commands/git-install

### Overview

- Implements the consumer-side Git source for `sks install <slug> --from <remote>`.
- Derives the source branch `skillsets/<slug>` from the requested local name, so users provide only the remote and slug.
- Acquires and validates the exact derived branch head in one command-level flow before handing the canonical local identity `personal/<slug>` to the shared activation pipeline.

### How it fits into the larger codebase

- The central command registration layer dispatches here only when `--from` is present. An install without `--from` continues through the existing Registrar path, and failures or user cancellation in this path are returned directly rather than triggering a Registrar fallback.
- Git acquisition is deliberately independent of Registrar APIs. It does not download dependencies or apply a dependency-materialization heuristic.
- Successful acquisition produces a normal local skillset directory, so activation reuses the same agent registry, install-directory resolution, and shared non-interactive installer as other local skillsets.
- The source checkout remains a Git working tree under the `personal/` storage bucket. This feature does not add custom provenance, durable trust state, or update behavior.

### Core Implementation

- The requested slug deterministically selects `skillsets/<slug>` and the destination `personal/<slug>`. The root `nori.json` must have exactly that slug as its `name` and `skillset` as its `type`; the remote cannot choose or override the local identity.
- Source approval happens before acquisition. Interactive installs require affirmative confirmation, while non-interactive and silent installs require `--trust-source`. Git remote-helper syntax (`<transport>::<address>`) is rejected before prompting because it can obscure the effective transport and bypass ordinary URL credential handling. For supported remotes, the displayed value is redacted, approval applies only to the current invocation, and declining or cancelling returns a cancelled command status rather than an error.
- Git-backed installation requires Git 2.29 or newer. Acquisition uses native Git with argument-array process execution and `--no-write-fetch-head`, so a credential-bearing fetch URL is not copied into `FETCH_HEAD` before the stored remote can be sanitized.
- Acquisition atomically reserves the destination, initializes a repository there, and fetches only `refs/heads/skillsets/<slug>` into the matching remote-tracking ref with depth one and tags disabled. This exact refspec selects the branch even when the remote also contains a same-named tag, while retaining a normal Git working tree for recovery and future operations.
- Every Git subprocess has a 60-second timeout. Non-interactive and silent invocations disable terminal, credential-manager, and askpass prompts. For SSH remotes, default OpenSSH receives `BatchMode=yes`; an existing `GIT_SSH`, `GIT_SSH_COMMAND`, or Git `core.sshCommand` is preserved rather than rewritten.
- Remote credentials are redacted from prompts and Git errors. After acquisition, the stored `origin` omits URL user information, query parameters, and fragments so fetch credentials are not retained in repository metadata.
- Validation parses NUL-delimited tracked entries before reading `nori.json`. Any tracked symbolic link or submodule and a root `.nori-version` are rejected, and the manifest itself must be a regular tracked file before its identity and type are read. Acquisition or validation errors remove the reserved destination.
- All configured default agents are resolved before the destination is reserved, so an invalid agent selection cannot leave a checkout behind. The full acquisition-and-activation flow participates in the global install transaction lock; its calls into the shared installer inherit that lock reentrantly rather than competing with their parent operation. After validation, each agent is activated through the shared non-interactive installer without persisting `activeSkillset`; only after every agent succeeds does this command persist the canonical identity. This feature does not introduce a reusable Git acquisition layer; the later pinning feature may extract one when it creates a second consumer.

### Things to Know

- Local-name collisions fail closed: an existing `personal/<slug>` path is never overwritten or reused, including when it is a symlink or an incomplete checkout.
- The checkout is a shallow, tag-free snapshot of the branch head at installation time. There is no `--pin` option and no automatic fetch, fast-forward, or session-restart update behavior in this slice.
- Validation intentionally stops at manifest identity/type and tracked-entry safety. Dependency declarations are not resolved through the Registrar and are not checked for matching materialized content by this command.
- Acquisition and validation failures clean up the checkout. Activation failures instead retain the validated checkout, leave `activeSkillset` uncommitted, and return a recovery command that preserves an explicit install-directory override and the effective single-agent scope. Dynamic recovery arguments are POSIX-shell-quoted so copy/paste replays paths and identities literally without shell expansion. Agent output already written before a later agent fails is not rolled back.
- Silent activation passes silent mode into the low-level installer, suppressing direct stream output as well as command framing while preserving the caller's prior silent state.
- Independent install or activation attempts fail while a live transaction owns the global lock, preventing the Git checkout, agent files, markers, and `activeSkillset` commit from interleaving with another invocation. Recognized owner markers with dead owners or an age over 24 hours, legacy owner records with the same stale conditions, and sufficiently old empty ownerless lock directories are recovered automatically; the age limit prevents PID reuse from preserving a stale lock indefinitely. Unknown nonempty lock contents remain busy rather than being deleted.
- The checkout contains credential-free Git origin and branch metadata but no Nori-specific source provenance or durable trust marker. It never carries Registrar `.nori-version` provenance and is never eligible for Registrar fallback behavior.
- Durable Git source metadata and an update adapter belong to the later update feature rather than this initial install slice.

Created and maintained by Nori.
