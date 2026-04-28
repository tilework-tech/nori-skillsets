/**
 * Tests for postinstall version sync.
 *
 * Verifies that ~/.nori-config.json's `version` field gets refreshed to match
 * the on-disk package.json after `npm install -g nori-skillsets@latest`.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { syncInstalledVersion } from "./syncInstalledVersion.js";

const writeFakePackage = (args: {
  packageRoot: string;
  version: string;
}): void => {
  const { packageRoot, version } = args;
  fs.mkdirSync(packageRoot, { recursive: true });
  fs.writeFileSync(
    path.join(packageRoot, "package.json"),
    JSON.stringify({ name: "nori-skillsets", version }),
  );
};

describe("syncInstalledVersion", () => {
  let tempDir: string;
  let configPath: string;
  let fakePackageRoot: string;
  let originalNoriGlobalConfig: string | undefined;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "sync-installed-version-test-"),
    );
    configPath = path.join(tempDir, ".nori-config.json");
    fakePackageRoot = path.join(tempDir, "fake-pkg");

    originalNoriGlobalConfig = process.env.NORI_GLOBAL_CONFIG;
    process.env.NORI_GLOBAL_CONFIG = tempDir;
  });

  afterEach(() => {
    if (originalNoriGlobalConfig === undefined) {
      delete process.env.NORI_GLOBAL_CONFIG;
    } else {
      process.env.NORI_GLOBAL_CONFIG = originalNoriGlobalConfig;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("should write the on-disk package version into config when stale", async () => {
    writeFakePackage({ packageRoot: fakePackageRoot, version: "2.5.0" });
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        version: "1.0.0",
        activeSkillset: "demo",
        installDir: tempDir,
      }),
    );

    await syncInstalledVersion({ startDir: fakePackageRoot });

    const written = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    expect(written.version).toBe("2.5.0");
    expect(written.activeSkillset).toBe("demo");
  });

  it("should preserve auth and other fields when syncing version", async () => {
    writeFakePackage({ packageRoot: fakePackageRoot, version: "3.0.0" });
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        version: "1.0.0",
        activeSkillset: "demo",
        auth: {
          username: "user@example.com",
          organizationUrl: "https://example.com",
          refreshToken: "refresh-abc",
        },
        autoupdate: "enabled",
        installDir: tempDir,
      }),
    );

    await syncInstalledVersion({ startDir: fakePackageRoot });

    const written = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    expect(written.version).toBe("3.0.0");
    expect(written.auth?.username).toBe("user@example.com");
    expect(written.auth?.refreshToken).toBe("refresh-abc");
    expect(written.activeSkillset).toBe("demo");
    expect(written.autoupdate).toBe("enabled");
  });

  it("should be a no-op when config file does not exist", async () => {
    writeFakePackage({ packageRoot: fakePackageRoot, version: "2.5.0" });

    await expect(
      syncInstalledVersion({ startDir: fakePackageRoot }),
    ).resolves.not.toThrow();

    expect(fs.existsSync(configPath)).toBe(false);
  });

  it("should be a no-op when current package version cannot be detected", async () => {
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        version: "1.0.0",
        activeSkillset: "demo",
        installDir: tempDir,
      }),
    );

    // startDir points somewhere with no nori-skillsets package.json above it
    const isolatedDir = fs.mkdtempSync(path.join(os.tmpdir(), "no-pkg-"));
    try {
      await syncInstalledVersion({ startDir: isolatedDir });
    } finally {
      fs.rmSync(isolatedDir, { recursive: true, force: true });
    }

    const written = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    expect(written.version).toBe("1.0.0");
  });

  it("should not throw when config file is invalid JSON", async () => {
    writeFakePackage({ packageRoot: fakePackageRoot, version: "2.5.0" });
    fs.writeFileSync(configPath, "this is not json {{{");

    await expect(
      syncInstalledVersion({ startDir: fakePackageRoot }),
    ).resolves.not.toThrow();

    // Malformed config is left alone; we don't blindly overwrite.
    expect(fs.readFileSync(configPath, "utf-8")).toBe("this is not json {{{");
  });
});
