import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("os", async (importOriginal) => {
  const actual = await importOriginal<typeof os>();
  return { ...actual, homedir: vi.fn().mockReturnValue(actual.homedir()) };
});

import {
  isTrusted,
  listTrust,
  recordTrust,
  revokeTrust,
} from "@/cli/features/trustStore.js";

const BRANCH = "skillsets/my-skill";
let home: string;

beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "trust-store-"));
  vi.mocked(os.homedir).mockReturnValue(home);
});

afterEach(async () => {
  await fs.rm(home, { recursive: true, force: true });
});

describe("trust store", () => {
  it("is empty and reports untrusted when the file is absent", async () => {
    expect(await listTrust()).toEqual([]);
    expect(await isTrusted({ remote: "https://h/o/r", branch: BRANCH })).toBe(
      false,
    );
  });

  it("records and reports a trusted (remote, branch)", async () => {
    await recordTrust({
      remote: "https://github.com/org/repo",
      branch: BRANCH,
    });
    expect(
      await isTrusted({
        remote: "https://github.com/org/repo",
        branch: BRANCH,
      }),
    ).toBe(true);
  });

  it("treats URL variants of the same remote as one trusted entry", async () => {
    await recordTrust({
      remote: "git@github.com:org/repo.git",
      branch: BRANCH,
    });
    expect(
      await isTrusted({
        remote: "ssh://git@github.com/org/repo",
        branch: BRANCH,
      }),
    ).toBe(true);
    // recording the variant again does not add a duplicate
    await recordTrust({ remote: "ssh://github.com/org/repo/", branch: BRANCH });
    expect(await listTrust()).toHaveLength(1);
  });

  it("keys trust by branch", async () => {
    await recordTrust({
      remote: "https://github.com/org/repo",
      branch: BRANCH,
    });
    expect(
      await isTrusted({
        remote: "https://github.com/org/repo",
        branch: "skillsets/other",
      }),
    ).toBe(false);
  });

  it("revokes a trusted entry and reports whether one was removed", async () => {
    await recordTrust({ remote: "git@github.com:org/repo", branch: BRANCH });
    expect(
      await revokeTrust({
        remote: "https://github.com/org/repo",
        branch: BRANCH,
      }),
    ).toBe(false); // different transport, not trusted
    expect(
      await revokeTrust({
        remote: "ssh://github.com/org/repo",
        branch: BRANCH,
      }),
    ).toBe(true);
    expect(
      await isTrusted({ remote: "git@github.com:org/repo", branch: BRANCH }),
    ).toBe(false);
  });

  it("does not persist plaintext credentials in the store", async () => {
    await recordTrust({
      remote: "https://user:secret@github.com/org/repo",
      branch: BRANCH,
    });
    const raw = await fs.readFile(
      path.join(home, ".nori", "trust.json"),
      "utf-8",
    );
    expect(raw).not.toContain("secret");
    expect(raw).not.toContain("user");
  });
});
