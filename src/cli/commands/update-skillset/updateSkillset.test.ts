import { execFile } from "node:child_process";
import * as fsSync from "node:fs";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const execFileAsync = promisify(execFile);
const git = async (cwd: string, ...command: Array<string>): Promise<string> => {
  const { stdout } = await execFileAsync("git", command, { cwd });
  return stdout.trim();
};

vi.mock("os", async (importOriginal) => {
  const actual = await importOriginal<typeof os>();
  return { ...actual, homedir: vi.fn().mockReturnValue(actual.homedir()) };
});

// Activation is exercised by the transaction; stub it so we can inject failure.
const mockActivate = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("@/cli/features/install/install.js", () => ({
  noninteractive: mockActivate,
}));

import { updateSkillsetMain } from "@/cli/commands/update-skillset/updateSkillset.js";

const SLUG = "my-skill";
const IDENTITY = `personal/${SLUG}`;
const noriJson = (name: string): string =>
  JSON.stringify({ name, type: "skillset", version: "1.0.0" });

let home: string;
let authorDir: string;
let checkoutDir: string;

const readCheckout = (p: string): string =>
  fsSync.readFileSync(path.join(checkoutDir, p), "utf-8");

beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "update-home-"));
  vi.mocked(os.homedir).mockReturnValue(home);
  mockActivate.mockClear();
  mockActivate.mockResolvedValue(undefined);

  const base = await fs.mkdtemp(path.join(os.tmpdir(), "update-remote-"));
  const remoteDir = path.join(base, "remote.git");
  authorDir = path.join(base, "author");
  await git(base, "init", "--bare", "--quiet", remoteDir);
  await fs.mkdir(authorDir);
  await git(authorDir, "init", "--quiet");
  await git(authorDir, "config", "user.email", "a@a.dev");
  await git(authorDir, "config", "user.name", "A");
  await git(authorDir, "checkout", "--quiet", "-b", `skillsets/${SLUG}`);
  await fs.writeFile(path.join(authorDir, "nori.json"), noriJson(SLUG));
  await fs.writeFile(path.join(authorDir, "content.md"), "v1");
  await git(authorDir, "add", ".");
  await git(authorDir, "commit", "--quiet", "-m", "v1");
  await git(authorDir, "remote", "add", "origin", remoteDir);
  await git(authorDir, "push", "--quiet", "-u", "origin", `skillsets/${SLUG}`);

  checkoutDir = path.join(home, ".nori", "profiles", "personal", SLUG);
  await fs.mkdir(path.dirname(checkoutDir), { recursive: true });
  await git(
    base,
    "clone",
    "--quiet",
    "--branch",
    `skillsets/${SLUG}`,
    remoteDir,
    checkoutDir,
  );

  await fs.writeFile(
    path.join(home, ".nori-config.json"),
    JSON.stringify({
      installDir: home,
      defaultAgents: ["claude-code"],
      activeSkillset: IDENTITY,
    }),
  );
});

afterEach(async () => {
  await fs.rm(home, { recursive: true, force: true });
});

const advanceRemote = async (content: string): Promise<void> => {
  await fs.writeFile(path.join(authorDir, "content.md"), content);
  await git(authorDir, "add", ".");
  await git(authorDir, "commit", "--quiet", "-m", content);
  await git(authorDir, "push", "--quiet", "origin", `skillsets/${SLUG}`);
};

describe("updateSkillsetMain", () => {
  it("errors on a non-Git-backed skillset", async () => {
    const result = await updateSkillsetMain({
      slug: "not-git",
      nonInteractive: true,
    });
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/not a Git-backed skillset/i);
  });

  it("reports up-to-date without activating", async () => {
    const result = await updateSkillsetMain({
      slug: SLUG,
      nonInteractive: true,
    });
    expect(result.success).toBe(true);
    expect(result.message).toMatch(/up to date/i);
    expect(mockActivate).not.toHaveBeenCalled();
  });

  it("fast-forwards and re-activates when the remote advanced", async () => {
    await advanceRemote("v2");
    const result = await updateSkillsetMain({
      slug: SLUG,
      nonInteractive: true,
    });
    expect(result.success).toBe(true);
    expect(result.message).toMatch(/updated/i);
    expect(mockActivate).toHaveBeenCalledWith(
      expect.objectContaining({ skillset: IDENTITY }),
    );
    expect(readCheckout("content.md")).toBe("v2");
  });

  it("undoes the checkout when activation fails", async () => {
    await advanceRemote("v2");
    const oldSha = await git(checkoutDir, "rev-parse", "HEAD");
    mockActivate.mockRejectedValueOnce(new Error("agent boom"));

    const result = await updateSkillsetMain({
      slug: SLUG,
      nonInteractive: true,
    });

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/restored the previous version/i);
    expect(await git(checkoutDir, "rev-parse", "HEAD")).toBe(oldSha);
    expect(readCheckout("content.md")).toBe("v1");
  });
});
