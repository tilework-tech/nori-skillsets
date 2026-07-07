import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  readVersionInfo,
  skillsetHasRegistrySource,
  writeVersionInfo,
} from "./provenance.js";

let tempDir: string;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "packaging-prov-"));
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe("writeVersionInfo / readVersionInfo", () => {
  it("round-trips version and registryUrl", async () => {
    await writeVersionInfo({
      dir: tempDir,
      versionInfo: { version: "1.2.3", registryUrl: "https://reg" },
    });
    const raw = await fs.readFile(path.join(tempDir, ".nori-version"), "utf-8");
    // Same on-disk shape the commands have always written
    expect(JSON.parse(raw)).toEqual({
      version: "1.2.3",
      registryUrl: "https://reg",
    });
    expect(await readVersionInfo({ dir: tempDir })).toEqual({
      version: "1.2.3",
      registryUrl: "https://reg",
    });
  });

  it("includes orgId only when provided", async () => {
    await writeVersionInfo({
      dir: tempDir,
      versionInfo: {
        version: "2.0.0",
        registryUrl: "https://reg",
        orgId: "acme",
      },
    });
    const parsed = JSON.parse(
      await fs.readFile(path.join(tempDir, ".nori-version"), "utf-8"),
    );
    expect(parsed).toEqual({
      version: "2.0.0",
      registryUrl: "https://reg",
      orgId: "acme",
    });
  });

  it("returns null for missing or malformed files", async () => {
    expect(await readVersionInfo({ dir: tempDir })).toBeNull();
    await fs.writeFile(path.join(tempDir, ".nori-version"), "not json");
    expect(await readVersionInfo({ dir: tempDir })).toBeNull();
  });
});

describe("skillsetHasRegistrySource", () => {
  it("is true when the package records a registry it was fetched from", async () => {
    await writeVersionInfo({
      dir: tempDir,
      versionInfo: {
        version: "1.0.0",
        registryUrl: "https://noriskillsets.dev",
      },
    });

    expect(await skillsetHasRegistrySource({ dir: tempDir })).toBe(true);
  });

  it("is false for a locally-created package with no .nori-version", async () => {
    expect(await skillsetHasRegistrySource({ dir: tempDir })).toBe(false);
  });

  it("is false when the .nori-version records no registryUrl", async () => {
    await fs.writeFile(
      path.join(tempDir, ".nori-version"),
      JSON.stringify({ version: "1.0.0" }),
    );

    expect(await skillsetHasRegistrySource({ dir: tempDir })).toBe(false);
  });

  it("is false when the .nori-version records an empty registryUrl", async () => {
    await fs.writeFile(
      path.join(tempDir, ".nori-version"),
      JSON.stringify({ version: "1.0.0", registryUrl: "" }),
    );

    expect(await skillsetHasRegistrySource({ dir: tempDir })).toBe(false);
  });
});
