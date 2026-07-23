# Noridoc: git-install

Path: @/src/cli/commands/git-install

### Overview

- Implements the consumer-side Git source for `sks install <slug> --from <remote>`, including optional historical selection with `--pin <full-sha>`.
- Derives the required source branch `refs/heads/skillsets/<slug>` from the requested local name, so users provide only the remote and slug. A same-name tag is not accepted in place of that branch.
- Clones and validates the checkout in one command-level flow before handing the canonical local identity `personal/<slug>` to the shared activation pipeline.

### How it fits into the larger codebase

- The central command registration layer dispatches here only when `--from` is present. An install without `--from` continues through the existing Registrar path, and failures in this path are returned directly rather than triggering a Registrar fallback.
- Git acquisition is deliberately independent of Registrar APIs. It does not download dependencies or apply a dependency-materialization heuristic.
- Successful acquisition produces a normal local skillset directory, so activation reuses the same agent registry, install-directory resolution, and shared non-interactive installer as other local skillsets.
- The source checkout remains a Git working tree under the `personal/` storage bucket. This feature does not add custom provenance, durable trust state, update behavior, or activation rollback.

### Core Implementation

- The requested slug deterministically selects `skillsets/<slug>` and the destination `personal/<slug>`. The root `nori.json` must have exactly that slug as its `name` and `skillset` as its `type`; the remote cannot choose or override the local identity.
- Source approval happens before acquisition. Interactive installs require affirmative confirmation, while non-interactive and silent installs require `--trust-source`. Approval applies to this command invocation only and is not persisted as a durable trust decision. URL-form userinfo is redacted regardless of URL scheme. Query-key matching percent-decodes and compatibility-normalizes the key before recognizing token, OAuth, client-secret, signing, and password parameters; both ampersand and semicolon separators are supported. The same sanitizer protects trust prompts and surfaced Git errors.
- Acquisition uses native Git with argument-array process execution and a shared status/error path. It removes inherited Git repository-routing variables (`GIT_DIR`, `GIT_WORK_TREE`, `GIT_COMMON_DIR`, `GIT_INDEX_FILE`, `GIT_OBJECT_DIRECTORY`, `GIT_ALTERNATE_OBJECT_DIRECTORIES`, and `GIT_SHALLOW_FILE`) while preserving ordinary non-prompting Git authentication behavior. Non-interactive and silent execution sets `GIT_TERMINAL_PROMPT=0` and adds OpenSSH `BatchMode=yes`, so Git credential, SSH host-key confirmation, and SSH password/passphrase challenges fail instead of opening a prompt. An inherited OpenSSH-compatible `GIT_SSH_COMMAND` keeps its unrelated options but is rejected if it explicitly disables batch mode, preventing an earlier `BatchMode=no` from overriding Nori's appended setting. Acquisition atomically reserves the final destination directory, then requests a normal full-history, single-branch clone into that directory with `--no-reject-shallow`, preventing user-level `clone.rejectShallow` configuration from changing Nori's policy.
- After cloning, acquisition resolves the explicit local `refs/heads/skillsets/<slug>` branch. This prevents a same-name tag or another ref from standing in for the required branch.
- Without `--pin`, acquisition accepts a shallow source, checks out the observed branch tip with the branch attached, and does not independently claim complete ancestry. With `--pin`, cloning uses `--no-checkout`, accepts only a 40-character SHA-1 or 64-character SHA-256 hexadecimal object ID, requires the supplied ID to equal Git's fully resolved object ID, rejects shallow repositories under Nori's own validation, verifies that the commit is reachable from the observed branch tip through Git's complete all-parent history, and checks it out with detached `HEAD`. Comparing the supplied and resolved IDs prevents a 40-character SHA-256 abbreviation from being treated as a full pin.
- Object inspection distinguishes a missing object from a failed Git operation. Missing pins receive the branch-history error, while corruption, permission, process, or malformed-output failures remain Git errors rather than being rewritten as user input errors.
- Validation parses NUL-delimited `git ls-files --stage -z` records before reading metadata, so unusual tracked pathnames cannot alter the safety checks. For every tracked path it normalizes the first root component with compatibility normalization, case folding, and removal of the code points Git ignores on HFS filesystems. It rejects symbolic links, submodules, and any normalized root component equal to `.nori-version`, including reserved directory aliases with content below them. It likewise rejects manifest aliases and manifest directories, requiring exactly one compatibility-equivalent manifest entry: the exact lowercase root `nori.json` tracked as a regular file. This prevents filesystem aliases, colliding entries, or manifest symlinks from becoming the authority. Clone and validation errors remove the reserved destination, leaving no partial local skillset.
- Validation runs after commit selection, so a pinned install validates the selected historical tree rather than the branch tip. After acquisition, activation targets every configured default agent by calling the shared non-interactive installer directly. Silent mode is established before activation, and the shared install emitters honor it, so a successful `--silent` Git install produces no loader status, warning, note, or banner output.

### Things to Know

- Local-name collisions fail closed: an existing `personal/<slug>` path is never overwritten or reused, including when it is a symlink or an incomplete checkout.
- Unpinned installs intentionally accept a shallow source, remain attached to `skillsets/<slug>`, and activate the observed tip. Only historical pinning requires enough history to prove ancestry. The explicit clone override makes both outcomes deterministic even when the user has enabled `clone.rejectShallow`.
- The checkout is a one-time snapshot at installation time. There is no automatic fetch, fast-forward, or session-restart update behavior. Detached `HEAD` is the only pin marker until a later feature adds durable source metadata.
- Successful pinned installs report the resolved full object ID. Abbreviated IDs (including 40-character abbreviations in SHA-256 repositories), refs, tags, revision expressions, missing objects, non-commit objects, commits outside the selected branch's all-parent history, and pinned sources whose complete history cannot be proven are rejected.
- Validation intentionally stops at manifest identity/type and tracked-entry safety. Dependency declarations are not resolved through the Registrar and are not checked for matching materialized content by this command.
- Acquisition and validation failures clean up the checkout. Once activation begins, normal installation semantics apply: there is no Git-specific transaction that removes the checkout, restores prior config, or rolls back agent output after an activation failure.
- Feature 2 directly owns exact historical commit acquisition. Its co-delivered changes to the shared tip/pin path are limited to authority, validation, diagnostics, unattended execution, and successful silent activation; they do not add update metadata, durable trust, transactional activation, or silent failure semantics.
- OpenSSH `BatchMode=yes` is the v1 SSH contract. Arbitrary `GIT_SSH_COMMAND` wrappers, Plink/TortoisePlink, and askpass compatibility are outside this feature.
- The Git process boundary closes child stdin for every command. Treating an `EPIPE` caused by Git exiting before consuming that input as a normal early close is an internal reliability measure, not a separate user-facing capability; other stdin failures remain part of the shared Git error result.
- The checkout contains Git's ordinary origin and branch metadata but no Nori-specific source provenance or durable trust marker. It never carries Registrar `.nori-version` provenance and is never eligible for Registrar fallback behavior.
- Durable Git source metadata and an update adapter belong to the later update feature rather than historical installation.

Created and maintained by Nori.
