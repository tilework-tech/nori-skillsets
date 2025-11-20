/**
 * Tests for CLI command routing and argument parsing with commander.js
 *
 * These tests verify BEHAVIOR not implementation:
 * - Commands route to the correct handlers
 * - Options are parsed and passed correctly
 * - Validation happens before handlers are called
 * - Default commands work as expected
 */

import { Command } from "commander";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { registerCheckCommand } from "@/installer/commands/check.js";
import { registerInstallCommand } from "@/installer/commands/install.js";
import { registerSwitchProfileCommand } from "@/installer/commands/switchProfile.js";
import { registerUninstallCommand } from "@/installer/commands/uninstall.js";
import * as installModule from "@/installer/install.js";
import * as profilesModule from "@/installer/profiles.js";
import * as uninstallModule from "@/installer/uninstall.js";

describe("CLI with commander.js", () => {
  let program: Command;

  beforeEach(() => {
    program = new Command();
    program.exitOverride(); // Prevent process.exit during tests

    // Mock the main functions
    vi.spyOn(installModule, "main").mockResolvedValue(undefined);
    vi.spyOn(uninstallModule, "main").mockResolvedValue(undefined);
    vi.spyOn(profilesModule, "switchProfile").mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("install command", () => {
    it("should route 'install' command to installMain with default options", async () => {
      // Setup program with global options
      program.option("--install-dir <path>");
      program.option("--non-interactive");

      registerInstallCommand({ program });

      // Parse: nori-ai install
      await program.parseAsync(["node", "nori-ai", "install"]);

      expect(installModule.main).toHaveBeenCalledWith({
        nonInteractive: null,
        installDir: null,
      });
    });

    it("should parse --non-interactive flag correctly", async () => {
      program.option("--install-dir <path>");
      program.option("--non-interactive");

      registerInstallCommand({ program });

      // Parse: nori-ai --non-interactive install
      await program.parseAsync([
        "node",
        "nori-ai",
        "--non-interactive",
        "install",
      ]);

      expect(installModule.main).toHaveBeenCalledWith({
        nonInteractive: true,
        installDir: null,
      });
    });

    it("should parse --install-dir option correctly", async () => {
      program.option("--install-dir <path>");
      program.option("--non-interactive");

      registerInstallCommand({ program });

      // Parse: nori-ai --install-dir /custom install
      await program.parseAsync([
        "node",
        "nori-ai",
        "--install-dir",
        "/custom/path",
        "install",
      ]);

      expect(installModule.main).toHaveBeenCalledWith({
        nonInteractive: null,
        installDir: "/custom/path",
      });
    });

    it("should parse both options together", async () => {
      program.option("--install-dir <path>");
      program.option("--non-interactive");

      registerInstallCommand({ program });

      // Parse: nori-ai --non-interactive --install-dir /custom install
      await program.parseAsync([
        "node",
        "nori-ai",
        "--non-interactive",
        "--install-dir",
        "/custom",
        "install",
      ]);

      expect(installModule.main).toHaveBeenCalledWith({
        nonInteractive: true,
        installDir: "/custom",
      });
    });
  });

  describe("uninstall command", () => {
    it("should route 'uninstall' command to uninstallMain", async () => {
      program.option("--install-dir <path>");
      program.option("--non-interactive");

      registerUninstallCommand({ program });

      // Parse: nori-ai uninstall
      await program.parseAsync(["node", "nori-ai", "uninstall"]);

      expect(uninstallModule.main).toHaveBeenCalledWith({
        nonInteractive: null,
        installDir: null,
      });
    });

    it("should pass options to uninstallMain", async () => {
      program.option("--install-dir <path>");
      program.option("--non-interactive");

      registerUninstallCommand({ program });

      // Parse: nori-ai --non-interactive uninstall
      await program.parseAsync([
        "node",
        "nori-ai",
        "--non-interactive",
        "uninstall",
      ]);

      expect(uninstallModule.main).toHaveBeenCalledWith({
        nonInteractive: true,
        installDir: null,
      });
    });
  });

  describe("check command", () => {
    it("should route 'check' command to checkMain", async () => {
      program.option("--install-dir <path>");
      program.option("--non-interactive");

      // Spy on console and process.exit to verify check runs
      const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {
        // Mock implementation
      });
      const processExitSpy = vi
        .spyOn(process, "exit")
        .mockImplementation(() => {
          throw new Error("process.exit called");
        });

      registerCheckCommand({ program });

      // Parse: nori-ai check
      // Note: check will try to run actual validation, which will fail in test environment
      // We expect it to attempt to run but fail - that proves the routing works
      try {
        await program.parseAsync(["node", "nori-ai", "check"]);
      } catch (err: any) {
        // Expected to fail in test environment
      }

      // Verify check command was invoked (console.log was called)
      expect(consoleLogSpy).toHaveBeenCalled();

      consoleLogSpy.mockRestore();
      processExitSpy.mockRestore();
    });
  });

  describe("switch-profile command", () => {
    it("should route 'switch-profile <name>' to switchProfile", async () => {
      program.option("--install-dir <path>");
      program.option("--non-interactive");

      registerSwitchProfileCommand({ program });

      // Parse: nori-ai switch-profile senior-swe
      await program.parseAsync([
        "node",
        "nori-ai",
        "switch-profile",
        "senior-swe",
      ]);

      expect(profilesModule.switchProfile).toHaveBeenCalledWith({
        profileName: "senior-swe",
        installDir: null,
      });

      // Verify installMain is also called after switchProfile
      expect(installModule.main).toHaveBeenCalledWith({
        nonInteractive: true,
        skipUninstall: true,
        installDir: null,
      });
    });

    it("should require profile name argument", async () => {
      program.option("--install-dir <path>");
      program.option("--non-interactive");

      registerSwitchProfileCommand({ program });

      // Parse: nori-ai switch-profile (missing argument)
      // Commander should throw an error about missing argument
      await expect(
        program.parseAsync(["node", "nori-ai", "switch-profile"]),
      ).rejects.toThrow();

      // Verify handlers were NOT called
      expect(profilesModule.switchProfile).not.toHaveBeenCalled();
      expect(installModule.main).not.toHaveBeenCalled();
    });
  });

  describe("default command", () => {
    it("should default to install when no command provided", async () => {
      program.option("--install-dir <path>");
      program.option("--non-interactive");

      registerInstallCommand({ program });

      // Set default action to call installMain
      program.action(async () => {
        const opts = program.opts();
        await installModule.main({
          nonInteractive: opts.nonInteractive || null,
          installDir: opts.installDir || null,
        });
      });

      // Parse: nori-ai (no command)
      await program.parseAsync(["node", "nori-ai"]);

      expect(installModule.main).toHaveBeenCalledWith({
        nonInteractive: null,
        installDir: null,
      });
    });

    it("should respect options even with default command", async () => {
      program.option("--install-dir <path>");
      program.option("--non-interactive");

      registerInstallCommand({ program });

      // Set default action
      program.action(async () => {
        const opts = program.opts();
        await installModule.main({
          nonInteractive: opts.nonInteractive || null,
          installDir: opts.installDir || null,
        });
      });

      // Parse: nori-ai --non-interactive (no command but with flag)
      await program.parseAsync(["node", "nori-ai", "--non-interactive"]);

      expect(installModule.main).toHaveBeenCalledWith({
        nonInteractive: true,
        installDir: null,
      });
    });
  });

  describe("help and version", () => {
    it("should not call any handler when --help is used", async () => {
      program.option("--install-dir <path>");
      program.option("--non-interactive");

      registerInstallCommand({ program });

      // Parse: nori-ai --help
      // Commander will throw an error with helpInformation when --help is used
      await expect(
        program.parseAsync(["node", "nori-ai", "--help"]),
      ).rejects.toThrow();

      // Verify no handlers were called
      expect(installModule.main).not.toHaveBeenCalled();
      expect(uninstallModule.main).not.toHaveBeenCalled();
    });

    it("should show version with --version", async () => {
      program.version("16.0.0");
      program.option("--install-dir <path>");
      program.option("--non-interactive");

      registerInstallCommand({ program });

      // Parse: nori-ai --version
      // Commander will throw an error when --version is used
      await expect(
        program.parseAsync(["node", "nori-ai", "--version"]),
      ).rejects.toThrow();

      // Verify no handlers were called
      expect(installModule.main).not.toHaveBeenCalled();
    });
  });

  describe("error handling", () => {
    it("should show error for unknown commands", async () => {
      program.option("--install-dir <path>");
      program.option("--non-interactive");

      registerInstallCommand({ program });

      // Parse: nori-ai invalid-command
      // Commander should error on unknown command
      await expect(
        program.parseAsync(["node", "nori-ai", "invalid-command"]),
      ).rejects.toThrow();

      // Verify no handlers were called
      expect(installModule.main).not.toHaveBeenCalled();
    });
  });
});
