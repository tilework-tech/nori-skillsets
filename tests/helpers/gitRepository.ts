import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const git = async (args: {
  cwd?: string;
  command: ReadonlyArray<string>;
}): Promise<string> => {
  const { cwd, command } = args;
  const result = await execFileAsync("git", command, { cwd });
  return result.stdout.trim();
};

export type TestGitRepository = {
  remote: string;
  authorCheckout: string;
  commit: (args: {
    slug: string;
    manifestName?: string;
    marker: string;
    manifest?: Record<string, unknown>;
    files?: Record<string, string>;
  }) => Promise<string>;
};

export const createTestGitRepository = async (args: {
  root: string;
}): Promise<TestGitRepository> => {
  const remote = path.join(args.root, "remote.git");
  const authorCheckout = path.join(args.root, "author");

  await fs.mkdir(remote, { recursive: true });
  await git({ cwd: remote, command: ["init", "--bare"] });
  await git({ command: ["init", authorCheckout] });
  await git({
    cwd: authorCheckout,
    command: ["config", "user.email", "tests@nori.invalid"],
  });
  await git({
    cwd: authorCheckout,
    command: ["config", "user.name", "Nori Tests"],
  });

  const commit = async (commitArgs: {
    slug: string;
    manifestName?: string;
    marker: string;
    manifest?: Record<string, unknown>;
    files?: Record<string, string>;
  }): Promise<string> => {
    const {
      slug,
      manifestName = slug,
      marker,
      manifest = {},
      files = {},
    } = commitArgs;
    await fs.writeFile(
      path.join(authorCheckout, "nori.json"),
      JSON.stringify({
        name: manifestName,
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
    await git({ cwd: authorCheckout, command: ["add", "."] });
    await git({ cwd: authorCheckout, command: ["commit", "-m", marker] });
    await git({
      cwd: authorCheckout,
      command: ["branch", "-M", `skillsets/${slug}`],
    });
    await git({
      cwd: authorCheckout,
      command: ["push", "--force", remote, `skillsets/${slug}`],
    });
    return git({ cwd: authorCheckout, command: ["rev-parse", "HEAD"] });
  };

  return { remote, authorCheckout, commit };
};
