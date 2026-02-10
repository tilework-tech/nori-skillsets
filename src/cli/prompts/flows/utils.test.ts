import * as clack from "@clack/prompts";
import { describe, expect, it, vi } from "vitest";

import { unwrapPrompt } from "./utils.js";

vi.mock("@clack/prompts", () => ({
  isCancel: vi.fn(() => false),
  cancel: vi.fn(),
}));

describe("unwrapPrompt", () => {
  it("should return the value when not cancelled", () => {
    vi.mocked(clack.isCancel).mockReturnValue(false);

    const result = unwrapPrompt({ value: "hello" });

    expect(result).toBe("hello");
    expect(clack.cancel).not.toHaveBeenCalled();
  });

  it("should return null and call cancel with default message on cancel", () => {
    const cancelSymbol = Symbol.for("cancel");
    vi.mocked(clack.isCancel).mockReturnValue(true);

    const result = unwrapPrompt({ value: cancelSymbol });

    expect(result).toBeNull();
    expect(clack.cancel).toHaveBeenCalledWith("Operation cancelled.");
  });

  it("should use custom cancelMessage when provided", () => {
    const cancelSymbol = Symbol.for("cancel");
    vi.mocked(clack.isCancel).mockReturnValue(true);

    const result = unwrapPrompt({
      value: cancelSymbol,
      cancelMessage: "Switch cancelled.",
    });

    expect(result).toBeNull();
    expect(clack.cancel).toHaveBeenCalledWith("Switch cancelled.");
  });
});
