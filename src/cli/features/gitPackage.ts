const HFS_IGNORED_CODE_POINTS =
  /[\u200C-\u200F\u202A-\u202E\u206A-\u206F\uFEFF]/gu;

export type TrackedGitEntry = {
  mode: string;
  path: string;
};

const normalizeReservedRootPath = (entryPath: string): string => {
  const [rootEntry = ""] = entryPath.split("/");
  return rootEntry
    .normalize("NFKC")
    .replace(HFS_IGNORED_CODE_POINTS, "")
    .toLowerCase();
};

export const validateGitPackageEntries = (args: {
  output: string;
}): Array<TrackedGitEntry> => {
  const entries = args.output
    .split("\0")
    .filter((record) => record.length > 0)
    .map((record) => {
      const match = /^(\d{6}) [0-9a-f]+ \d+\t([\s\S]+)$/u.exec(record);
      if (match == null) {
        throw new Error("Git returned invalid tracked-entry output");
      }
      return { mode: match[1], path: match[2] };
    });

  if (
    entries.some(
      (entry) => normalizeReservedRootPath(entry.path) === ".nori-version",
    )
  ) {
    throw new Error(
      "Git-backed skillsets cannot contain Registry provenance (.nori-version)",
    );
  }
  if (entries.some((entry) => entry.mode === "120000")) {
    throw new Error("Git-backed skillsets cannot contain symbolic links");
  }
  if (entries.some((entry) => entry.mode === "160000")) {
    throw new Error("Git-backed skillsets cannot contain submodules");
  }

  const manifests = entries.filter(
    (entry) => normalizeReservedRootPath(entry.path) === "nori.json",
  );
  const manifest = manifests[0];
  if (
    manifests.length !== 1 ||
    manifest == null ||
    manifest.path !== "nori.json" ||
    (manifest.mode !== "100644" && manifest.mode !== "100755")
  ) {
    throw new Error(
      "Git-backed skillsets require an exact root nori.json regular file",
    );
  }

  return entries;
};
