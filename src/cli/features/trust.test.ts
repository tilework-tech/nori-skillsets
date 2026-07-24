import { describe, expect, it } from "vitest";

import { canonicalizeRemoteForTrust } from "@/cli/features/gitPackage.js";

describe("canonicalizeRemoteForTrust", () => {
  it("collapses scp-form and ssh:// form of the same remote", () => {
    const scp = canonicalizeRemoteForTrust({
      remote: "git@github.com:org/repo.git",
    });
    const ssh = canonicalizeRemoteForTrust({
      remote: "ssh://git@github.com/org/repo",
    });
    expect(scp).toBe(ssh);
  });

  it("strips a trailing .git and trailing slash", () => {
    expect(
      canonicalizeRemoteForTrust({ remote: "https://github.com/org/repo.git" }),
    ).toBe(
      canonicalizeRemoteForTrust({ remote: "https://github.com/org/repo/" }),
    );
  });

  it("strips embedded credentials", () => {
    expect(
      canonicalizeRemoteForTrust({
        remote: "https://user:pass@github.com/org/repo",
      }),
    ).toBe(
      canonicalizeRemoteForTrust({ remote: "https://github.com/org/repo" }),
    );
  });

  it("lowercases the host but preserves path case", () => {
    const key = canonicalizeRemoteForTrust({
      remote: "https://GitHub.com/Org/Repo",
    });
    expect(key).toContain("github.com");
    expect(key).toContain("Org/Repo");
  });

  it("keeps different transports distinct (ssh vs https)", () => {
    const ssh = canonicalizeRemoteForTrust({
      remote: "git@github.com:org/repo",
    });
    const https = canonicalizeRemoteForTrust({
      remote: "https://github.com/org/repo",
    });
    expect(ssh).not.toBe(https);
  });

  it("does not leak credentials in the canonical key", () => {
    const key = canonicalizeRemoteForTrust({
      remote: "https://user:secret@github.com/org/repo",
    });
    expect(key).not.toContain("secret");
    expect(key).not.toContain("user");
  });
});
