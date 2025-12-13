import * as fs from "fs";

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  setSilentMode,
  isSilentMode,
  error,
  success,
  info,
  warn,
  debug,
  LOG_FILE,
} from "@/cli/logger.js";

describe("logger silent mode", () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Reset silent mode before each test
    setSilentMode({ silent: false });

    // Spy on console methods - suppress output during tests
    consoleLogSpy = vi
      .spyOn(console, "log")
      .mockImplementation(() => undefined);
    consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    // Restore console methods
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();

    // Reset silent mode
    setSilentMode({ silent: false });
  });

  it("should have silent mode disabled by default", () => {
    expect(isSilentMode()).toBe(false);
  });

  it("should enable silent mode when setSilentMode is called with true", () => {
    setSilentMode({ silent: true });
    expect(isSilentMode()).toBe(true);
  });

  it("should disable silent mode when setSilentMode is called with false", () => {
    setSilentMode({ silent: true });
    setSilentMode({ silent: false });
    expect(isSilentMode()).toBe(false);
  });

  it("should suppress info output when silent mode is enabled", () => {
    setSilentMode({ silent: true });
    info({ message: "test info message" });
    expect(consoleLogSpy).not.toHaveBeenCalled();
  });

  it("should suppress success output when silent mode is enabled", () => {
    setSilentMode({ silent: true });
    success({ message: "test success message" });
    expect(consoleLogSpy).not.toHaveBeenCalled();
  });

  it("should suppress warn output when silent mode is enabled", () => {
    setSilentMode({ silent: true });
    warn({ message: "test warn message" });
    expect(consoleLogSpy).not.toHaveBeenCalled();
  });

  it("should suppress error output when silent mode is enabled", () => {
    setSilentMode({ silent: true });
    error({ message: "test error message" });
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it("should output info when silent mode is disabled", () => {
    info({ message: "test info message" });
    expect(consoleLogSpy).toHaveBeenCalled();
  });

  it("should output success when silent mode is disabled", () => {
    success({ message: "test success message" });
    expect(consoleLogSpy).toHaveBeenCalled();
  });

  it("should output warn when silent mode is disabled", () => {
    warn({ message: "test warn message" });
    expect(consoleLogSpy).toHaveBeenCalled();
  });

  it("should output error when silent mode is disabled", () => {
    error({ message: "test error message" });
    expect(consoleErrorSpy).toHaveBeenCalled();
  });
});

describe("logger file output", () => {
  const testLogFile = LOG_FILE;

  beforeEach(() => {
    setSilentMode({ silent: false });
  });

  afterEach(() => {
    setSilentMode({ silent: false });
  });

  it("should export LOG_FILE as /tmp/nori.log", () => {
    expect(LOG_FILE).toBe("/tmp/nori.log");
  });

  it("should write info messages to log file", async () => {
    const uniqueId = `info-${Date.now()}-${Math.random()}`;
    info({ message: uniqueId });
    // Give Winston time to flush to file
    await new Promise((resolve) => setTimeout(resolve, 200));
    const content = fs.readFileSync(testLogFile, "utf-8");
    expect(content).toContain(uniqueId);
    expect(content).toContain("[INFO]");
  });

  it("should write error messages to log file with ERROR level", async () => {
    const uniqueId = `error-${Date.now()}-${Math.random()}`;
    error({ message: uniqueId });
    await new Promise((resolve) => setTimeout(resolve, 200));
    const content = fs.readFileSync(testLogFile, "utf-8");
    expect(content).toContain(uniqueId);
    expect(content).toContain("[ERROR]");
  });

  it("should write success messages to log file with SUCCESS level", async () => {
    const uniqueId = `success-${Date.now()}-${Math.random()}`;
    success({ message: uniqueId });
    await new Promise((resolve) => setTimeout(resolve, 200));
    const content = fs.readFileSync(testLogFile, "utf-8");
    expect(content).toContain(uniqueId);
    expect(content).toContain("[SUCCESS]");
  });

  it("should write warn messages to log file with WARN level", async () => {
    const uniqueId = `warn-${Date.now()}-${Math.random()}`;
    warn({ message: uniqueId });
    await new Promise((resolve) => setTimeout(resolve, 200));
    const content = fs.readFileSync(testLogFile, "utf-8");
    expect(content).toContain(uniqueId);
    expect(content).toContain("[WARN]");
  });

  it("should write debug messages to log file with DEBUG level", async () => {
    const uniqueId = `debug-${Date.now()}-${Math.random()}`;
    debug({ message: uniqueId });
    await new Promise((resolve) => setTimeout(resolve, 200));
    const content = fs.readFileSync(testLogFile, "utf-8");
    expect(content).toContain(uniqueId);
    expect(content).toContain("[DEBUG]");
  });

  it("should continue writing to log file even when silent mode is enabled", async () => {
    setSilentMode({ silent: true });
    const uniqueId = `silent-${Date.now()}-${Math.random()}`;
    info({ message: uniqueId });
    await new Promise((resolve) => setTimeout(resolve, 200));
    const content = fs.readFileSync(testLogFile, "utf-8");
    expect(content).toContain(uniqueId);
  });
});

describe("logger console output format", () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    setSilentMode({ silent: false });
    consoleLogSpy = vi
      .spyOn(console, "log")
      .mockImplementation(() => undefined);
    consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    setSilentMode({ silent: false });
  });

  it("should prefix error messages with 'Error: '", () => {
    error({ message: "something went wrong" });
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Error: something went wrong"),
    );
  });

  it("should prefix warn messages with 'Warning: '", () => {
    warn({ message: "be careful" });
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining("Warning: be careful"),
    );
  });

  it("should output error messages in red", () => {
    error({ message: "red error" });
    // Red ANSI code is \x1b[0;31m or \x1b[31m
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringMatching(/\x1b\[.*31m/),
    );
  });

  it("should output success messages in green", () => {
    success({ message: "green success" });
    // Green ANSI code is \x1b[0;32m or \x1b[32m
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringMatching(/\x1b\[.*32m/),
    );
  });

  it("should output info messages in cyan/blue", () => {
    info({ message: "blue info" });
    // Cyan ANSI code is \x1b[36m
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringMatching(/\x1b\[36m/),
    );
  });

  it("should output warn messages in yellow", () => {
    warn({ message: "yellow warning" });
    // Yellow ANSI code is \x1b[1;33m or \x1b[33m
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringMatching(/\x1b\[.*33m/),
    );
  });
});
