import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readGitSource } from "@/cli/features/gitPackage.js";

const execFileAsync = promisify(execFile);
const git = async (cwd: string, ...command: Array<string>): Promise<string> => {
  const { stdout } = await execFileAsync("git", command, { cwd });
  return stdout.trim();
};

let checkoutDir: string;

beforeEach(async () => {
  checkoutDir = await fs.mkdtemp(path.join(os.tmpdir(), "git-source-"));
  await git(checkoutDir, "init", "--quiet");
  await git(checkoutDir, "config", "user.email", "t@t.dev");
  await git(checkoutDir, "config", "user.name", "T");
  await git(
    checkoutDir,
    "config",
    "remote.origin.url",
    "https://example.com/org/skillsets.git",
  );
  await fs.writeFile(path.join(checkoutDir, "nori.json"), "{}");
  await git(checkoutDir, "add", ".");
  await git(checkoutDir, "commit", "--quiet", "-m", "init");
  await git(checkoutDir, "checkout", "--quiet", "-b", "skillsets/my-skill");
});

afterEach(async () => {
  await fs.rm(checkoutDir, { recursive: true, force: true });
});

describe("readGitSource", () => {
  it("reports a following checkout (on the branch)", async () => {
    const source = await readGitSource({ checkoutDir });
    expect(source.mode).toBe("following");
    expect(source.branch).toBe("skillsets/my-skill");
    expect(source.remote).toBe("https://example.com/org/skillsets.git");
    expect(source.resolvedSha).toMatch(/^[0-9a-f]{40}$/u);
  });

  it("reports a pinned checkout (detached HEAD)", async () => {
    const sha = await git(checkoutDir, "rev-parse", "HEAD");
    await git(checkoutDir, "checkout", "--quiet", "--detach", sha);

    const source = await readGitSource({ checkoutDir });
    expect(source.mode).toBe("pinned");
    expect(source.branch).toBeNull();
    expect(source.resolvedSha).toBe(sha);
    expect(source.remote).toBe("https://example.com/org/skillsets.git");
  });

  it("reports a null remote when origin is absent", async () => {
    await git(checkoutDir, "remote", "remove", "origin").catch(() => undefined);
    const source = await readGitSource({ checkoutDir });
    expect(source.remote).toBeNull();
  });
});
