import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("os", async (importOriginal) => {
  const actual = await importOriginal<typeof os>();
  return { ...actual, homedir: vi.fn().mockReturnValue(actual.homedir()) };
});

import { trustListMain, trustRevokeMain } from "@/cli/commands/trust/trust.js";
import { recordTrust } from "@/cli/features/trustStore.js";

const BRANCH = "skillsets/my-skill";
let home: string;

beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "trust-cmd-"));
  vi.mocked(os.homedir).mockReturnValue(home);
});

afterEach(async () => {
  await fs.rm(home, { recursive: true, force: true });
});

describe("trust command", () => {
  it("reports no trusted sources when empty", async () => {
    const result = await trustListMain();
    expect(result.success).toBe(true);
    expect(result.message).toMatch(/no trusted/i);
  });

  it("lists trusted sources", async () => {
    await recordTrust({
      remote: "https://github.com/org/repo",
      branch: BRANCH,
    });
    const result = await trustListMain();
    expect(result.message).toContain("github.com/org/repo");
    expect(result.message).toContain(BRANCH);
  });

  it("revokes a trusted source by any URL variant, then is a no-op", async () => {
    await recordTrust({ remote: "git@github.com:org/repo", branch: BRANCH });

    const revoked = await trustRevokeMain({
      remote: "ssh://github.com/org/repo",
      slug: "my-skill",
    });
    expect(revoked.success).toBe(true);
    expect(revoked.message).toMatch(/revoked/i);

    const again = await trustRevokeMain({
      remote: "ssh://github.com/org/repo",
      slug: "my-skill",
    });
    expect(again.success).toBe(false);
    expect(again.message).toMatch(/no trust entry/i);
  });
});
