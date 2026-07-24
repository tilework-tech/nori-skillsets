# Noridoc: publish-skillset

Path: @/src/cli/commands/publish-skillset

### Overview

- Implements deliberate producer-side publication with `sks publish <skillset> --to <remote> [--message <text>] [--yes]`.
- Publishes the complete reviewed Git workspace to the required `skillsets/<slug>` branch without introducing Registrar, activation, update, or trust behavior.
- Uses ordinary Git commits and fast-forward protection while preserving the author's local recovery state on failure.

### How it fits into the larger codebase

- The central Commander registration requires an explicit destination, forwards global non-interactive/silent state, and lazy-loads this command implementation.
- Existing local-profile resolution supplies one canonical directory and identity. Bare names honor `defaultOrg`; explicit namespaces are not rewritten.
- The tracked-entry validator shared with Git installation keeps both producer and consumer paths aligned on the exact root manifest and prohibited Git/package entries.
- The command operates only on an existing local Git-native skillset. It does not call Registrar APIs, activate provider output, persist provenance or trust, or configure a local Git remote/upstream.

### Core Implementation

- The resolved skillset must be the real root of its Git repository. Its identity basename becomes both the required staged manifest name and the remote branch slug.
- Before staging, the command snapshots the exact index file. `git add -A` then forms the publication unit from the complete non-ignored workspace; validation and the displayed diff both read that staged snapshot.
- Tracked entries must include exactly the lowercase root regular file `nori.json`. Registry `.nori-version` provenance, symbolic links, and gitlinks/submodules are rejected using the same normalized-entry policy as Git installation.
- The staged manifest must have type `skillset` and a name equal to the local slug. Every declared skill must contain `skills/<name>/SKILL.md`; every declared subagent must use `subagents/<name>/SUBAGENT.md` or `subagents/<name>.md`. Invalid dependency names, absent materialized dependencies, and non-empty slash-command dependencies are rejected.
- The staged diff disables external diff drivers and color, then sanitizes terminal control characters before display. Interactive confirmation defaults to No; non-interactive and silent publication requires `--yes`.
- Changed content is committed with ordinary Git identity, hooks, and signing configuration. The default message is `Publish <slug>`, and `--message` supplies an alternative. A clean repository reuses its existing `HEAD`.
- After a commit, the command verifies that `HEAD^{tree}` still equals the reviewed staged tree. It then pushes the explicit refspec `HEAD:refs/heads/skillsets/<slug>` with no force option, leaving Git to enforce fast-forward-only branch updates.

### Things to Know

- Cancellation, validation, and any other failure before a successful commit restore the original index bytes; working-tree files and existing history are not rewritten.
- Once `git commit` succeeds, any tree-verification or push failure keeps the new local commit. This avoids rewriting `HEAD` and gives the author a stable object to inspect, reconcile, and retry.
- A hook may reject the commit normally, but a hook-created commit whose tree differs from the reviewed tree is retained and never published.
- Publication never fetches, merges, rebases, force-pushes, or changes local remote/upstream configuration. A remote rejection is resolved outside this command before retry.
- Destination URLs and Git errors are sanitized before display; use Git credential helpers or SSH agents instead of embedding credentials in the command line.

Created and maintained by Nori.
