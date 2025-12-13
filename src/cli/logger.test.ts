import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  setSilentMode,
  isSilentMode,
  error,
  success,
  info,
  warn,
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
