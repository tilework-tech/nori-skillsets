# Noridoc: GitHub Actions Workflows

Path: @/.github/workflows

### Overview

- CI and release automation for the nori-skillsets package
- Handles continuous integration checks on all PRs and pushes, stable npm releases from git tags, and automatic `@next` prerelease deploys on every push to `main`

### How it fits into the larger codebase

- `ci.yml` runs build, lint, and tests on every push to `main` and every PR targeting `main`, acting as the quality gate for all code changes
- `skillsets-release.yml` is the single release pipeline -- it builds, tests, publishes to npm, and creates GitHub releases. It handles tag pushes (stable releases), pushes to `main` (`@next` prereleases), and manual workflow dispatch
- The release workflow depends on `@/scripts/package_skillsets.sh` for tarball creation and uses npm OIDC Trusted Publishing (Node 24 / npm 11.5.1+) for authentication
- Stable releases are initiated by pushing a `skillsets-v*.*.*` tag, typically created by `@/scripts/create_skillsets_release.py`

### Core Implementation

The release workflow (`skillsets-release.yml`) has three trigger paths:

```
Tag push (skillsets-v*.*.*)  ──> validate ──> build ──> publish-npm ──> create-release
                                                                         (stable @latest)

Push to main branch          ──> validate ──> build ──> create-next-tag ──> publish-npm
                                                          (@next prerelease, no GitHub Release)

workflow_dispatch (manual)   ──> validate ──> build ──> [publish-npm if not dry_run]
                                                         (@next or @latest)
```

**Tag-push detection** uses `github.event_name == 'push' && startsWith(github.ref, 'refs/tags/')` to distinguish tag pushes from branch pushes, since both have `event_name == 'push'`. The `is_tag_push` output from the `validate` job is the canonical way to determine if a run is a tag-push release.

**Main branch push detection**: When `event_name == 'push'` and `github.ref == 'refs/heads/main'`, the workflow treats it as `publish_next=true` and auto-determines the next `-next.N` version.

**Version determination for `@next`**: The validate job scans existing `skillsets-v*` tags, extracts the latest base version, finds the highest existing `-next.N` suffix for that base version, and increments to produce the next version (e.g., `1.2.0-next.3` -> `1.2.0-next.4`).

**Concurrency**: The workflow uses `cancel-in-progress` only for `main` branch pushes (via `github.ref == 'refs/heads/main'`), so if multiple pushes to `main` happen in quick succession, only the latest one publishes. Tag pushes are not cancelled.

### Things to Know

- All npm publishing goes through a single workflow file (`skillsets-release.yml`) -- this is required because npm OIDC Trusted Publishing whitelists a specific workflow file
- The `publish-npm` job gates on `needs.validate.outputs.is_tag_push == 'true'` rather than `github.event_name == 'push'` -- this invariant is critical for preventing branch pushes from being treated as stable releases
- GitHub Releases are only created for stable tag-push releases (not for `@next` prereleases) to avoid flooding the Releases page
- Stable releases also update the `@next` dist-tag to point to the stable version, so `@next` always represents the most recent published version of any kind
- The `create-next-tag` job creates a git tag for `@next` releases so they are traceable in the repository history
- npm publishing uses OIDC Trusted Publishing (no `NODE_AUTH_TOKEN`), which requires Node 24 and the `npm-publish` environment configured in GitHub

Created and maintained by Nori.
