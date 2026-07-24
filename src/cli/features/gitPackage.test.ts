import { execFile } from "node:child_process";
import * as fsSync from "node:fs";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  readGitSource,
  updateFollowingCheckout,
} from "@/cli/features/gitPackage.js";

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

describe("updateFollowingCheckout", () => {
  const SLUG = "my-skill";
  let remoteDir: string;
  let authorDir: string;
  let coDir: string;

  const noriJson = (name: string): string =>
    JSON.stringify({ name, type: "skillset", version: "1.0.0" });

  beforeEach(async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), "git-update-"));
    remoteDir = path.join(base, "remote.git");
    authorDir = path.join(base, "author");
    coDir = path.join(base, "checkout");

    await git(base, "init", "--bare", "--quiet", remoteDir);

    await fs.mkdir(authorDir);
    await git(authorDir, "init", "--quiet");
    await git(authorDir, "config", "user.email", "t@t.dev");
    await git(authorDir, "config", "user.name", "T");
    await git(authorDir, "checkout", "--quiet", "-b", `skillsets/${SLUG}`);
    await fs.writeFile(path.join(authorDir, "nori.json"), noriJson(SLUG));
    await fs.writeFile(path.join(authorDir, "content.md"), "v1");
    await git(authorDir, "add", ".");
    await git(authorDir, "commit", "--quiet", "-m", "v1");
    await git(authorDir, "remote", "add", "origin", remoteDir);
    await git(
      authorDir,
      "push",
      "--quiet",
      "-u",
      "origin",
      `skillsets/${SLUG}`,
    );

    await git(
      base,
      "clone",
      "--quiet",
      "--branch",
      `skillsets/${SLUG}`,
      remoteDir,
      coDir,
    );
    await git(coDir, "config", "user.email", "c@c.dev");
    await git(coDir, "config", "user.name", "C");
  });

  afterEach(async () => {
    await fs.rm(path.dirname(remoteDir), { recursive: true, force: true });
  });

  const advanceRemote = async (content: string): Promise<void> => {
    await fs.writeFile(path.join(authorDir, "content.md"), content);
    await git(authorDir, "add", ".");
    await git(authorDir, "commit", "--quiet", "-m", content);
    await git(authorDir, "push", "--quiet", "origin", `skillsets/${SLUG}`);
  };

  const read = (p: string): string =>
    fsSync.readFileSync(path.join(coDir, p), "utf-8");

  it("fast-forwards to the new tip and stays on the branch", async () => {
    await advanceRemote("v2");
    const result = await updateFollowingCheckout({
      checkoutDir: coDir,
      slug: SLUG,
      nonInteractive: true,
    });
    expect(result.outcome).toBe("updated");
    expect(result.newSha).not.toBe(result.oldSha);
    expect(read("content.md")).toBe("v2");
    const src = await readGitSource({ checkoutDir: coDir });
    expect(src.mode).toBe("following");
    expect(src.resolvedSha).toBe(result.newSha);
  });

  it("reports up-to-date when the remote has not advanced", async () => {
    const result = await updateFollowingCheckout({
      checkoutDir: coDir,
      slug: SLUG,
      nonInteractive: true,
    });
    expect(result.outcome).toBe("up-to-date");
    expect(read("content.md")).toBe("v1");
  });

  it("refuses a pinned (detached) checkout", async () => {
    const sha = await git(coDir, "rev-parse", "HEAD");
    await git(coDir, "checkout", "--quiet", "--detach", sha);
    await expect(
      updateFollowingCheckout({
        checkoutDir: coDir,
        slug: SLUG,
        nonInteractive: true,
      }),
    ).rejects.toThrow(/pinned/i);
  });

  it("refuses a dirty checkout (untracked file)", async () => {
    await advanceRemote("v2");
    await fs.writeFile(path.join(coDir, "local-scratch.txt"), "x");
    await expect(
      updateFollowingCheckout({
        checkoutDir: coDir,
        slug: SLUG,
        nonInteractive: true,
      }),
    ).rejects.toThrow(/uncommitted/i);
    expect(read("content.md")).toBe("v1");
  });

  it("refuses when the branch has diverged", async () => {
    // local commit
    await fs.writeFile(path.join(coDir, "content.md"), "local-change");
    await git(coDir, "add", ".");
    await git(coDir, "commit", "--quiet", "-m", "local");
    // remote advances separately
    await advanceRemote("v2");
    await expect(
      updateFollowingCheckout({
        checkoutDir: coDir,
        slug: SLUG,
        nonInteractive: true,
      }),
    ).rejects.toThrow(/diverged/i);
  });

  it("refuses when the local checkout is ahead of the remote", async () => {
    await fs.writeFile(path.join(coDir, "content.md"), "ahead");
    await git(coDir, "add", ".");
    await git(coDir, "commit", "--quiet", "-m", "ahead");
    await expect(
      updateFollowingCheckout({
        checkoutDir: coDir,
        slug: SLUG,
        nonInteractive: true,
      }),
    ).rejects.toThrow(/ahead/i);
  });

  it("resets to the previous tip when the new tip fails validation", async () => {
    // advance the remote with a manifest whose name no longer matches the slug
    await fs.writeFile(path.join(authorDir, "nori.json"), noriJson("renamed"));
    await git(authorDir, "add", ".");
    await git(authorDir, "commit", "--quiet", "-m", "rename");
    await git(authorDir, "push", "--quiet", "origin", `skillsets/${SLUG}`);

    const before = await git(coDir, "rev-parse", "HEAD");
    await expect(
      updateFollowingCheckout({
        checkoutDir: coDir,
        slug: SLUG,
        nonInteractive: true,
      }),
    ).rejects.toThrow(/does not match/i);

    // checkout was reset back to the previous tip
    expect(await git(coDir, "rev-parse", "HEAD")).toBe(before);
    expect(JSON.parse(read("nori.json")).name).toBe(SLUG);
  });

  it("rejects a new tip that introduces a tracked symlink and resets", async () => {
    await fs.symlink("nori.json", path.join(authorDir, "evil-link"));
    await git(authorDir, "add", ".");
    await git(authorDir, "commit", "--quiet", "-m", "symlink");
    await git(authorDir, "push", "--quiet", "origin", `skillsets/${SLUG}`);

    const before = await git(coDir, "rev-parse", "HEAD");
    await expect(
      updateFollowingCheckout({
        checkoutDir: coDir,
        slug: SLUG,
        nonInteractive: true,
      }),
    ).rejects.toThrow(/symbolic link|failed validation/i);

    expect(await git(coDir, "rev-parse", "HEAD")).toBe(before);
    expect(fsSync.existsSync(path.join(coDir, "evil-link"))).toBe(false);
  });

  it("leaves the checkout untouched when the fetch fails", async () => {
    // Delete the branch on the remote so the fetch cannot find it.
    await git(
      authorDir,
      "push",
      "--quiet",
      "origin",
      "--delete",
      `skillsets/${SLUG}`,
    );
    const before = await git(coDir, "rev-parse", "HEAD");

    await expect(
      updateFollowingCheckout({
        checkoutDir: coDir,
        slug: SLUG,
        nonInteractive: true,
      }),
    ).rejects.toThrow();

    expect(await git(coDir, "rev-parse", "HEAD")).toBe(before);
    expect(read("content.md")).toBe("v1");
  });

  it("refuses a shallow checkout", async () => {
    // Give the branch history to truncate, so a depth-1 clone is truly shallow.
    await advanceRemote("v2");
    const originUrl = await git(coDir, "config", "--get", "remote.origin.url");
    // `file://` forces a real (shallow-capable) clone; a plain local path clone
    // ignores --depth.
    const shallowUrl = originUrl.startsWith("/")
      ? `file://${originUrl}`
      : originUrl;
    const shallowDir = path.join(path.dirname(coDir), "shallow");
    await git(
      path.dirname(coDir),
      "clone",
      "--quiet",
      "--depth",
      "1",
      "--branch",
      `skillsets/${SLUG}`,
      shallowUrl,
      shallowDir,
    );

    await expect(
      updateFollowingCheckout({
        checkoutDir: shallowDir,
        slug: SLUG,
        nonInteractive: true,
      }),
    ).rejects.toThrow(/shallow/i);
  });
});
