import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
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

export const createTestGitRepository = async (args: {
  root: string;
  objectFormat?: "sha1" | "sha256" | null;
}) => {
  const { root, objectFormat } = args;
  const remote = path.join(root, "remote.git");
  const authorCheckout = path.join(root, "author");

  await fs.mkdir(remote, { recursive: true });
  const objectFormatArgs =
    objectFormat == null ? [] : [`--object-format=${objectFormat}`];
  await git(remote, "init", "--bare", ...objectFormatArgs);
  await git(undefined, "init", ...objectFormatArgs, authorCheckout);
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
    await git(authorCheckout, "push", "--force", remote, `skillsets/${slug}`);
    return git(authorCheckout, "rev-parse", "HEAD");
  };

  const commitUnrelated = async (args: {
    marker?: string | null;
  }): Promise<string> => {
    const marker = args.marker ?? "unrelated history";
    const tree = await git(authorCheckout, "write-tree");
    const commitSha = await git(
      authorCheckout,
      "commit-tree",
      tree,
      "-m",
      marker,
    );
    await git(
      authorCheckout,
      "push",
      remote,
      `${commitSha}:refs/heads/unrelated`,
    );
    return commitSha;
  };

  const mergeSecondParent = async (args: {
    slug: string;
    marker?: string | null;
  }): Promise<string> => {
    const { slug } = args;
    const marker = args.marker ?? "second-parent history";
    const branchTip = await git(authorCheckout, "rev-parse", "HEAD");
    const tree = await git(authorCheckout, "write-tree");
    const secondParent = await git(
      authorCheckout,
      "commit-tree",
      tree,
      "-m",
      marker,
    );
    const mergeCommit = await git(
      authorCheckout,
      "commit-tree",
      tree,
      "-p",
      branchTip,
      "-p",
      secondParent,
      "-m",
      `merge ${marker}`,
    );
    await git(authorCheckout, "reset", "--hard", mergeCommit);
    await git(authorCheckout, "push", "--force", remote, `skillsets/${slug}`);
    return secondParent;
  };

  const createShallowRemote = async (args: {
    slug: string;
  }): Promise<string> => {
    const { slug } = args;
    const shallowRemote = path.join(root, "limited-source");
    await git(
      undefined,
      "clone",
      "--depth",
      "1",
      "--branch",
      `skillsets/${slug}`,
      `file://${remote}`,
      shallowRemote,
    );
    return shallowRemote;
  };

  const replaceBranchWithTag = async (args: {
    slug: string;
  }): Promise<void> => {
    const { slug } = args;
    const refName = `skillsets/${slug}`;
    await git(authorCheckout, "tag", "--force", refName, "HEAD");
    await git(
      authorCheckout,
      "push",
      "--force",
      remote,
      `refs/tags/${refName}`,
    );
    await git(authorCheckout, "push", remote, `:refs/heads/${refName}`);
  };

  return {
    remote,
    authorCheckout,
    commit,
    commitUnrelated,
    mergeSecondParent,
    createShallowRemote,
    replaceBranchWithTag,
  };
};
