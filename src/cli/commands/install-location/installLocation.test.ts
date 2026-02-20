/**
 * Tests for install-location command
 * Tests the installLocationMain function displays config-based install directories
 */

import * as fs from "fs/promises";
import * as os from "os";
import { tmpdir } from "os";
import * as path from "path";

import { log, note, outro } from "@clack/prompts";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { installLocationMain } from "./installLocation.js";

// Mock @clack/prompts
vi.mock("@clack/prompts", () => ({
  log: {
    error: vi.fn(),
    info: vi.fn(),
  },
  note: vi.fn(),
  outro: vi.fn(),
}));

// Mock os.homedir
vi.mock("os", async (importOriginal) => {
  const actual = await importOriginal<typeof os>();
  return {
    ...actual,
    homedir: vi.fn().mockReturnValue(actual.homedir()),
  };
});

// Mock process.exit
const mockExit = vi
  .spyOn(process, "exit")
  .mockImplementation(() => undefined as never);

// Mock process.stdout.write for non-interactive output
const mockStdoutWrite = vi
  .spyOn(process.stdout, "write")
  .mockImplementation(() => true);

describe("installLocationMain", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(tmpdir(), "install-location-test-"));
    vi.mocked(os.homedir).mockReturnValue(tempDir);
    vi.mocked(log.error).mockClear();
    vi.mocked(note).mockClear();
    vi.mocked(outro).mockClear();
    mockExit.mockClear();
    mockStdoutWrite.mockClear();
  });

  afterEach(async () => {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  describe("with config installDir", () => {
    it("should display config installDir in output", async () => {
      const customDir = path.join(tempDir, "custom-install");
      await fs.mkdir(customDir, { recursive: true });

      // Create config with custom installDir
      const configPath = path.join(tempDir, ".nori-config.json");
      await fs.writeFile(
        configPath,
        JSON.stringify({
          activeSkillset: "test-profile",
          installDir: customDir,
        }),
      );

      await installLocationMain({});

      // Verify the config installDir appears in the displayed note content
      expect(note).toHaveBeenCalledWith(
        expect.stringContaining(customDir),
        expect.any(String),
      );
      expect(mockExit).not.toHaveBeenCalled();
    });

    it("should display home directory when no config exists", async () => {
      await installLocationMain({});

      // Should show the home directory in the output
      expect(note).toHaveBeenCalledWith(
        expect.stringContaining(tempDir),
        expect.any(String),
      );
      expect(mockExit).not.toHaveBeenCalled();
    });
  });

  describe("--non-interactive flag", () => {
    it("should output config installDir as plain text", async () => {
      const customDir = "/custom/install/path";

      const configPath = path.join(tempDir, ".nori-config.json");
      await fs.writeFile(
        configPath,
        JSON.stringify({
          activeSkillset: "test-profile",
          installDir: customDir,
        }),
      );

      await installLocationMain({ nonInteractive: true });

      // Should write the config installDir to stdout
      expect(mockStdoutWrite).toHaveBeenCalledWith(
        expect.stringContaining(customDir),
      );
      expect(note).not.toHaveBeenCalled();
    });
  });
});
