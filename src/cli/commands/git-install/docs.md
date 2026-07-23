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
- Source approval happens before acquisition. Interactive installs require affirmative confirmation, while non-interactive and silent installs require `--trust-source`. Git remote-helper syntax (`<transport>::<address>`) and URL schemes outside the explicit `http`, `https`, `ssh`, `git`, `git+ssh`, and `file` allowlist are rejected before prompting because they can invoke arbitrary Git transport helpers. Local paths and SCP-style SSH remotes remain supported. For supported remotes, the displayed value is redacted, approval applies only to the current invocation, and declining or cancelling returns a cancelled command status rather than an error.
- Git-backed installation requires Git 2.29 or newer. Acquisition uses native Git with argument-array process execution and `--no-write-fetch-head`, so a credential-bearing fetch URL is not copied into `FETCH_HEAD` before the stored remote can be sanitized.
- Acquisition atomically reserves the destination, initializes a repository there, and fetches only `refs/heads/skillsets/<slug>` into the matching remote-tracking ref with tags disabled. This exact refspec selects the branch even when the remote also contains a same-named tag, while retaining a normal Git working tree for recovery and future operations.
- Every Git subprocess has a 60-second timeout. Non-interactive and silent invocations disable terminal, credential-manager, and askpass prompts. For SSH remotes, default OpenSSH receives `BatchMode=yes`; an existing `GIT_SSH`, `GIT_SSH_COMMAND`, or Git `core.sshCommand` is preserved rather than rewritten.
- Remote credentials are redacted from prompts and Git errors, and C0/C1 terminal control characters are replaced before any remote-supplied text is displayed. After acquisition, the stored `origin` removes passwords, query parameters, fragments, and HTTP(S)/file usernames so fetch credentials are not retained in repository metadata.
- Validation parses NUL-delimited tracked entries before reading `nori.json`. Any tracked symbolic link or submodule and a root `.nori-version` (matched case-insensitively for case-insensitive filesystems) are rejected, and the manifest itself must be a regular tracked file before its identity and type are read. Acquisition or validation errors remove the reserved destination.
- All configured default agents are resolved before the destination is reserved, so an invalid agent selection cannot leave a checkout behind. After validation, each agent is activated through the existing shared non-interactive installer with persistence of the target identity disabled. Nested initialization may still rewrite the existing global `activeSkillset` value, but the Git command commits the target identity `personal/<slug>` exactly once and only after every configured agent succeeds. An explicit install-directory override makes the operation transient and skips that final commit. This command-level ordering does not add rollback or a shared transactional-activation mechanism. This feature does not introduce a reusable Git acquisition layer; the later pinning feature may extract one when it creates a second consumer.
- The Git command locally buffers console, stdout, and stderr output from each nested activation. It discards that buffered output when activation or the final target-identity commit fails, so a nested `Installation Complete` message cannot precede or contradict the outer failure. After overall success it replays the buffered output in order for both global and explicit-install-directory installs; silent mode discards it even on success. This buffering is confined to the Git command, which reports the overall result after its activation and, when applicable, final-commit work finishes.

### Things to Know

- Local-name collisions fail closed: an existing `personal/<slug>` path is never overwritten or reused, including when it is a symlink or an incomplete checkout.
- The checkout is a tag-free snapshot of the branch head at installation time. There is no `--pin` option and no automatic fetch, fast-forward, or session-restart update behavior in this slice.
- Validation intentionally stops at manifest identity/type and tracked-entry safety. Dependency declarations are not resolved through the Registrar and are not checked for matching materialized content by this command.
- Acquisition and validation failures clean up the checkout. Activation failures instead retain the validated checkout and return a recovery command that preserves an explicit install-directory override and the effective single-agent scope. Dynamic recovery arguments are POSIX-shell-quoted so copy/paste replays paths and identities literally without shell expansion. If a later agent fails, output written by an earlier successful agent may remain, but the target-identity commit is not attempted; no agent output is rolled back.
- A failure of the final target-identity commit is distinct from an activation failure: every configured agent has already activated, the previous global `activeSkillset` remains selected, and the validated checkout is retained. The reported recovery command can be rerun after correcting the config-write problem; it does not imply that completed agent output was rolled back.
- The checkout contains sanitized Git origin and branch metadata but no Nori-specific source provenance or durable trust marker. Usernames for SSH-style and other non-HTTP transports may remain because they select the remote account rather than authenticate it. The checkout never carries Registrar `.nori-version` provenance and is never eligible for Registrar fallback behavior.
- Durable Git source metadata and an update adapter belong to the later update feature rather than this initial install slice.

Created and maintained by Nori.
