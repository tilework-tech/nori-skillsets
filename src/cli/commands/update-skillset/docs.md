# Noridoc: update-skillset

Path: @/src/cli/commands/update-skillset

### Overview

`sks update <slug>` advances a *following* Git-backed skillset to the latest tip
of its `skillsets/<slug>` branch — fast-forward only — and re-activates it. It
is the consumer-side counterpart to `install <slug> --from <remote>`; registry
skillsets are not handled here (they refresh on switch).

### How it fits into the larger codebase

- The command (`updateSkillsetMain`) runs under `withInstallLock` and delegates
  the Git work to `updateFollowingCheckout` in @/src/cli/features/gitPackage.ts
  (the shared Git module), then re-activates through the non-interactive
  installer inside `withActivationTransaction`.
- The checkout lives at `~/.nori/profiles/personal/<slug>` — the same location
  `git-install` writes. A following install is on the branch; a pinned install
  is a detached HEAD.

### Behavior

- **Refusals (each an actionable error; the checkout is left untouched):** the
  target is not a Git working tree (registry skillset); the checkout is pinned
  (detached HEAD — pins are immutable); the working tree is dirty
  (`git status --porcelain` non-empty, including untracked files); the checkout
  is shallow (a fast-forward cannot be verified); the branch has diverged; or
  the local checkout is ahead of the remote.
- **Up-to-date:** the remote tip equals the current HEAD — success, no activation.
- **Fast-forward:** fetch the exact `skillsets/<slug>` branch, `merge --ff-only`
  to the fetched SHA (passing the explicit SHA, since no upstream is assumed),
  then re-validate the fetched tip with the shared `validateCheckout` (tracked
  symlink/submodule/`.nori-version` rejection, exact root `nori.json`, manifest
  name/type). Then re-activate across all configured agents.

### Two composed rollback layers

A failed update restores the previous usable state through two separately-owned
layers (mirroring "keep acquisition cleanup separate from activation rollback"):

- **Git source:** the update adapter exposes `undo()` = `git reset --hard <oldSha>`.
  It is a complete undo precisely because a dirty tree is refused. Validation
  failure on the fetched tip triggers it inside the adapter; activation failure
  triggers it from the command.
- **Rendered output:** activation runs inside `withActivationTransaction`, which
  snapshots and restores the managed agent files on any throw.

### Things to Know

- Activation uses `noninteractive` (which throws), not `main` (which
  `process.exit`s), so a mid-activation failure reaches the command's `catch`
  and runs `undo()`.
- The transaction owns the single `activeSkillset` commit: per-agent activation
  passes `persistActiveSkillset: false`, and the pointer is committed once,
  gated on a non-transient install dir (`--install-dir` is transient).
- Never contacts the Registrar on any path.

Created and maintained by Nori.
