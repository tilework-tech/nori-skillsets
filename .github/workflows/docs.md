# Noridoc: GitHub Actions Workflows

Path: @/.github/workflows

### Overview

- CI and release automation for the nori-skillsets package
- Handles continuous integration checks on all PRs and pushes, stable npm releases from git tags, and automatic `@next` prerelease deploys on every push to `main`

### How it fits into the larger codebase

- `ci.yml` runs build, lint, and tests on every push to `main` and every PR targeting `main`, acting as the quality gate for all code changes
- `skillsets-release.yml` is the central release pipeline -- it builds, tests, publishes to npm, and creates GitHub releases. It serves as both a standalone workflow (for tag pushes and manual dispatch) and a reusable workflow (called by `auto-next.yml`)
- `auto-next.yml` triggers on every push to `main` and calls `skillsets-release.yml` as a reusable workflow with `publish_next: true`, ensuring the latest `main` code is always available on npm as `nori-skillsets@next`
- The release workflow depends on `@/scripts/package_skillsets.sh` for tarball creation and uses npm OIDC Trusted Publishing (Node 24 / npm 11.5.1+) for authentication
- Stable releases are initiated by pushing a `skillsets-v*.*.*` tag, typically created by `@/scripts/create_skillsets_release.py`

### Core Implementation

The release workflow (`skillsets-release.yml`) has three trigger paths:

```
Tag push (skillsets-v*.*.*)  ──> validate ──> build ──> publish-npm ──> create-release
                                                                         (stable @latest)

workflow_dispatch (manual)   ──> validate ──> build ──> [publish-npm if not dry_run]
                                                         (@next or @latest)

workflow_call (from           ──> validate ──> build ──> create-next-tag ──> publish-npm
  auto-next.yml)                                          (@next prerelease, no GitHub Release)
```

**Tag-push detection** uses `github.ref == refs/tags/*` rather than `github.event_name == 'push'`. This is necessary because when called via `workflow_call`, the `github.event_name` inherits from the calling workflow -- so a branch push triggering `auto-next.yml` would appear as `event_name == 'push'`, making it indistinguishable from a tag push. The `is_tag_push` output from the `validate` job is the canonical way to determine if a run is a tag-push release.

**Version determination for `@next`**: The validate job scans existing `skillsets-v*` tags, extracts the latest base version, finds the highest existing `-next.N` suffix for that base version, and increments to produce the next version (e.g., `1.2.0-next.3` -> `1.2.0-next.4`).

**Concurrency**: `auto-next.yml` uses `cancel-in-progress: true` with a fixed concurrency group (`auto-next-deploy`), so if multiple pushes to `main` happen in quick succession, only the latest one publishes.

### Things to Know

- The `publish-npm` job gates on `needs.validate.outputs.is_tag_push == 'true'` rather than `github.event_name == 'push'` -- this invariant is critical for preventing branch pushes from being treated as stable releases when invoked via `workflow_call`
- GitHub Releases are only created for stable tag-push releases (not for `@next` prereleases) to avoid flooding the Releases page
- Stable releases also update the `@next` dist-tag to point to the stable version, so `@next` always represents the most recent published version of any kind
- The `create-next-tag` job creates a git tag for `@next` releases so they are traceable in the repository history
- npm publishing uses OIDC Trusted Publishing (no `NODE_AUTH_TOKEN`), which requires Node 24 and the `npm-publish` environment configured in GitHub

Created and maintained by Nori.
