import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const git = async (
  cwd: string | undefined,
  ...command: Array<string>
): Promise<string> => {
  const result = await execFileAsync("git", command, { cwd });
  return result.stdout.trim();
};

type CommitArgs = {
  slug: string;
  marker?: string;
  manifest?: Record<string, unknown>;
  files?: Record<string, string>;
};

export const createTestGitRepository = async (root: string) => {
  const remote = path.join(root, "remote.git");
  const fileRemote = pathToFileURL(remote).href;
  const authorCheckout = path.join(root, "author");

  await fs.mkdir(remote, { recursive: true });
  await git(remote, "init", "--bare");
  await git(undefined, "init", authorCheckout);
  await git(authorCheckout, "config", "user.email", "tests@nori.invalid");
  await git(authorCheckout, "config", "user.name", "Nori Tests");

  const commit = async (commitArgs: CommitArgs): Promise<string> => {
    const {
      slug,
      marker = "test skillset",
      manifest = {},
      files = {},
    } = commitArgs;
    await fs.writeFile(
      path.join(authorCheckout, "nori.json"),
      JSON.stringify({
        name: slug,
        version: "1.0.0",
        type: "skillset",
        ...manifest,
      }),
    );
    await fs.writeFile(path.join(authorCheckout, "AGENTS.md"), marker);
    for (const [relativePath, contents] of Object.entries(files)) {
      const filePath = path.join(authorCheckout, relativePath);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, contents);
    }
    await git(authorCheckout, "add", ".");
    await git(authorCheckout, "commit", "-m", marker);
    await git(authorCheckout, "branch", "-M", `skillsets/${slug}`);
    await git(
      authorCheckout,
      "push",
      "--force",
      remote,
      `refs/heads/skillsets/${slug}`,
    );
    return git(authorCheckout, "rev-parse", "HEAD");
  };

  return { remote, fileRemote, authorCheckout, commit };
};
