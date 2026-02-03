/**
 * Tests for password prompt wrapper
 */

import * as clack from "@clack/prompts";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { promptPassword } from "@/cli/prompts/password.js";

// Mock @clack/prompts
vi.mock("@clack/prompts", () => ({
  password: vi.fn(),
  isCancel: vi.fn(),
  cancel: vi.fn(),
}));

describe("promptPassword", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(clack.isCancel).mockReturnValue(false);
  });

  it("should return user password input", async () => {
    vi.mocked(clack.password).mockResolvedValue("secret123");

    const result = await promptPassword({ message: "Enter password" });

    expect(result).toBe("secret123");
    expect(clack.password).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Enter password",
      }),
    );
  });

  it("should pass placeholder to @clack/prompts when provided", async () => {
    vi.mocked(clack.password).mockResolvedValue("mypassword");

    await promptPassword({
      message: "Password",
      placeholder: "Enter your password",
    });

    expect(clack.password).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Password",
        placeholder: "Enter your password",
      }),
    );
  });

  it("should call handleCancel when user cancels", async () => {
    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });

    vi.mocked(clack.password).mockResolvedValue(Symbol.for("cancel") as any);
    vi.mocked(clack.isCancel).mockReturnValue(true);

    await expect(promptPassword({ message: "Password" })).rejects.toThrow(
      "process.exit called",
    );

    expect(clack.cancel).toHaveBeenCalledWith("Operation cancelled.");
    expect(mockExit).toHaveBeenCalledWith(0);
    mockExit.mockRestore();
  });

  it("should not include placeholder when not provided", async () => {
    vi.mocked(clack.password).mockResolvedValue("test");

    await promptPassword({ message: "Enter password" });

    const callArgs = vi.mocked(clack.password).mock.calls[0][0];
    expect(callArgs).not.toHaveProperty("placeholder");
  });
});
