/**
 * Tests for upload file filter
 */

import { describe, it, expect } from "vitest";

import {
  shouldExcludeFromUpload,
  collectCargoManifestDirs,
} from "./uploadFileFilter.js";

describe("shouldExcludeFromUpload", () => {
  it("excludes the local download metadata file", () => {
    expect(shouldExcludeFromUpload({ relativePath: ".nori-version" })).toBe(
      true,
    );
  });

  it("excludes vim swap files (.swp/.swo)", () => {
    expect(shouldExcludeFromUpload({ relativePath: ".SKILL.md.swp" })).toBe(
      true,
    );
    expect(shouldExcludeFromUpload({ relativePath: ".SKILL.md.swo" })).toBe(
      true,
    );
    expect(shouldExcludeFromUpload({ relativePath: ".notes.txt.swp" })).toBe(
      true,
    );
  });

  it("excludes Vim/Emacs backup files (trailing tilde)", () => {
    expect(shouldExcludeFromUpload({ relativePath: "SKILL.md~" })).toBe(true);
    expect(shouldExcludeFromUpload({ relativePath: "notes.txt~" })).toBe(true);
  });

  it("excludes macOS Finder metadata", () => {
    expect(shouldExcludeFromUpload({ relativePath: ".DS_Store" })).toBe(true);
  });

  it("excludes macOS AppleDouble resource forks", () => {
    expect(shouldExcludeFromUpload({ relativePath: "._SKILL.md" })).toBe(true);
    expect(shouldExcludeFromUpload({ relativePath: "._image.png" })).toBe(true);
  });

  it("excludes Windows thumbnail database", () => {
    expect(shouldExcludeFromUpload({ relativePath: "Thumbs.db" })).toBe(true);
  });

  it("does not exclude regular skill content files", () => {
    expect(shouldExcludeFromUpload({ relativePath: "SKILL.md" })).toBe(false);
    expect(shouldExcludeFromUpload({ relativePath: "nori.json" })).toBe(false);
    expect(shouldExcludeFromUpload({ relativePath: "AGENTS.md" })).toBe(false);
    expect(shouldExcludeFromUpload({ relativePath: "script.sh" })).toBe(false);
    expect(shouldExcludeFromUpload({ relativePath: "README.md" })).toBe(false);
  });

  it("does not exclude files with tilde elsewhere in the name", () => {
    expect(shouldExcludeFromUpload({ relativePath: "~tildaFile.md" })).toBe(
      false,
    );
    expect(shouldExcludeFromUpload({ relativePath: "some~file.md" })).toBe(
      false,
    );
  });

  it("does not exclude files that merely contain 'swp' but are not swap files", () => {
    expect(shouldExcludeFromUpload({ relativePath: "swap.md" })).toBe(false);
    expect(shouldExcludeFromUpload({ relativePath: "myswp.txt" })).toBe(false);
  });

  it("does not exclude DS_Store-lookalikes that don't match exactly", () => {
    expect(shouldExcludeFromUpload({ relativePath: ".ds_store" })).toBe(false);
    expect(shouldExcludeFromUpload({ relativePath: "DS_Store" })).toBe(false);
  });

  it("matches the basename when given a relative or absolute path", () => {
    expect(
      shouldExcludeFromUpload({
        relativePath: "skills/my-skill/.SKILL.md.swp",
      }),
    ).toBe(true);
    expect(
      shouldExcludeFromUpload({
        relativePath: "/abs/path/.DS_Store",
      }),
    ).toBe(true);
    expect(
      shouldExcludeFromUpload({
        relativePath: "skills/my-skill/SKILL.md",
      }),
    ).toBe(false);
  });

  describe("dependency / build bloat directories", () => {
    it("excludes node_modules at the top level", () => {
      expect(
        shouldExcludeFromUpload({
          relativePath: "node_modules/lodash/index.js",
        }),
      ).toBe(true);
    });

    it("excludes node_modules at any nesting depth", () => {
      expect(
        shouldExcludeFromUpload({
          relativePath: "skills/foo/node_modules/lodash/index.js",
        }),
      ).toBe(true);
      expect(
        shouldExcludeFromUpload({
          relativePath: "a/b/c/node_modules/pkg/dist/bundle.js",
        }),
      ).toBe(true);
    });

    it("excludes .venv at any nesting depth", () => {
      expect(
        shouldExcludeFromUpload({
          relativePath: ".venv/bin/python",
        }),
      ).toBe(true);
      expect(
        shouldExcludeFromUpload({
          relativePath: "skills/py-skill/.venv/lib/site-packages/foo.py",
        }),
      ).toBe(true);
    });

    it("does not exclude a leaf file literally named node_modules or .venv", () => {
      expect(shouldExcludeFromUpload({ relativePath: "node_modules" })).toBe(
        false,
      );
      expect(shouldExcludeFromUpload({ relativePath: ".venv" })).toBe(false);
      expect(shouldExcludeFromUpload({ relativePath: "docs/.venv" })).toBe(
        false,
      );
    });

    it("does not exclude lookalike directories", () => {
      expect(
        shouldExcludeFromUpload({
          relativePath: "node_modules_old/pkg/index.js",
        }),
      ).toBe(false);
      expect(
        shouldExcludeFromUpload({ relativePath: "my.venv/lib/foo.py" }),
      ).toBe(false);
      expect(
        shouldExcludeFromUpload({
          relativePath: "target_old/debug/app",
          cargoManifestDirs: new Set(["target_old"]),
        }),
      ).toBe(false);
    });

    it("excludes target only when a sibling Cargo.toml directory is known", () => {
      const cargoManifestDirs = new Set(["rustcrate"]);
      expect(
        shouldExcludeFromUpload({
          relativePath: "rustcrate/target/debug/app",
          cargoManifestDirs,
        }),
      ).toBe(true);
    });

    it("excludes nested target dirs adjacent to a Cargo.toml", () => {
      const cargoManifestDirs = new Set(["skills/rs/crate"]);
      expect(
        shouldExcludeFromUpload({
          relativePath: "skills/rs/crate/target/release/bin",
          cargoManifestDirs,
        }),
      ).toBe(true);
    });

    it("excludes a target dir at the repo root when Cargo.toml is at the root", () => {
      const cargoManifestDirs = new Set([""]);
      expect(
        shouldExcludeFromUpload({
          relativePath: "target/debug/app",
          cargoManifestDirs,
        }),
      ).toBe(true);
    });

    it("does not exclude target when there is no adjacent Cargo.toml", () => {
      expect(
        shouldExcludeFromUpload({
          relativePath: "data/target/results.json",
          cargoManifestDirs: new Set<string>(),
        }),
      ).toBe(false);
    });

    it("does not exclude target when the Cargo.toml is in a different directory", () => {
      const cargoManifestDirs = new Set(["othercrate"]);
      expect(
        shouldExcludeFromUpload({
          relativePath: "data/target/results.json",
          cargoManifestDirs,
        }),
      ).toBe(false);
    });

    it("does not exclude a leaf file literally named target", () => {
      const cargoManifestDirs = new Set(["rustcrate"]);
      expect(
        shouldExcludeFromUpload({
          relativePath: "rustcrate/target",
          cargoManifestDirs,
        }),
      ).toBe(false);
    });
  });
});

describe("collectCargoManifestDirs", () => {
  it("returns the directories that contain a Cargo.toml", () => {
    const dirs = collectCargoManifestDirs({
      relativePaths: [
        "rustcrate/Cargo.toml",
        "rustcrate/src/main.rs",
        "skills/rs/crate/Cargo.toml",
        "SKILL.md",
      ],
    });
    expect(dirs).toEqual(new Set(["rustcrate", "skills/rs/crate"]));
  });

  it("records the empty string when Cargo.toml is at the root", () => {
    const dirs = collectCargoManifestDirs({
      relativePaths: ["Cargo.toml", "src/main.rs"],
    });
    expect(dirs).toEqual(new Set([""]));
  });

  it("returns an empty set when no Cargo.toml is present", () => {
    const dirs = collectCargoManifestDirs({
      relativePaths: ["SKILL.md", "src/main.rs"],
    });
    expect(dirs).toEqual(new Set<string>());
  });

  it("does not treat a file merely named Cargo.toml-ish as a manifest", () => {
    const dirs = collectCargoManifestDirs({
      relativePaths: ["crate/Cargo.toml.bak", "crate/notCargo.toml"],
    });
    expect(dirs).toEqual(new Set<string>());
  });
});
