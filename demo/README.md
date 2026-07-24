# Milestone 1 demo — Git-backed skillsets

`git-skillsets-demo.sh` walks the git-backed-skillsets milestone end to end, with
**no Registrar and no login** — everything happens over Git:

**create → publish → install (via primary remote) → pin → update → fork → trust**

It's self-contained: it stands up a local bare Git "remote" and two isolated Nori
homes (an author and a consumer), so it runs anywhere and is fully repeatable.

## Run it

```bash
npm run build                      # build the CLI once (produces build/)
demo/git-skillsets-demo.sh         # interactive: press Enter between steps (for a live walkthrough)
demo/git-skillsets-demo.sh --auto  # hands-off, sleeps between steps (good for recording)
```

Run against a real Git remote instead of a local one (needs push access), so the
published `skillsets/senior-swe` and `skillsets/senior-swe-mine` branches are
observable on the remote:

```bash
demo/git-skillsets-demo.sh --remote git@github.com:your-org/your-repo.git
```

Add `--cleanup` to have it tear down the branches it pushed when it exits
(including on Ctrl-C or a closed web-terminal tab) — so a real-remote run leaves
nothing behind:

```bash
demo/git-skillsets-demo.sh --remote <url> --cleanup
```

Requires Node 20+ (the CLI's fetch dependency needs the `File` global).

## What it shows

| Step | Command | Point |
|------|---------|-------|
| Create | `sks new senior-swe` | Offline, editable Git-native skillset |
| Publish | `sks publish senior-swe --to <remote>` | Deliberate commit + fast-forward push |
| Configure | `sks config --primary-remote <remote>` | Bare-name installs now resolve to Git |
| Install | `sks install senior-swe --trust-source` | Bare-name Git install + durable (TOFU) trust |
| Pin | `sks install senior-swe --from <remote> --pin <sha>` | Reproducible historical version (detached) |
| Update | `sks update senior-swe` | Fast-forward-only, transactional re-activation |
| Fork | `sks fork personal/senior-swe senior-swe-mine` | Independent copy, republishable |
| Trust | `sks trust list` / `sks trust revoke <remote> <slug>` | Revocable trust; canonicalized remote key |

Cleanup is automatic (a temp workspace, removed on exit).
