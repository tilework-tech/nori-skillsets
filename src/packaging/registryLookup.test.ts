import { describe, expect, it, vi } from "vitest";

import { NetworkError, REGISTRAR_URL } from "@/api/registrar.js";
import {
  formatMultipleMatchesError,
  formatVersionList,
  searchSpecificRegistry,
} from "@/packaging/registryLookup.js";

import type { Packument } from "@/api/registrar.js";

const localeDate = (args: { iso: string }): string => {
  const { iso } = args;
  return new Date(iso).toLocaleDateString();
};

const makePackument = (args: {
  name: string;
  distTags?: Record<string, string> | null;
  versions?: Array<string> | null;
  time?: Record<string, string> | null;
  description?: string | null;
}): Packument => {
  const { name, distTags, versions, time, description } = args;
  const packument: Packument = {
    name,
    "dist-tags": distTags ?? { latest: "1.0.0" },
    versions: Object.fromEntries(
      (versions ?? ["1.0.0"]).map((version) => [version, { name, version }]),
    ),
  };
  if (time != null) {
    packument.time = time;
  }
  if (description != null) {
    packument.description = description;
  }
  return packument;
};

describe("formatVersionList", () => {
  it("lists dist-tags first, then versions newest-first with tags and dates", () => {
    const packument = makePackument({
      name: "test-pkg",
      distTags: { latest: "2.0.0", beta: "2.1.0-beta.1" },
      versions: ["1.0.0", "2.1.0-beta.1", "2.0.0"],
      time: {
        "1.0.0": "2024-01-01T00:00:00.000Z",
        "2.0.0": "2024-03-01T00:00:00.000Z",
        "2.1.0-beta.1": "2024-04-01T00:00:00.000Z",
      },
    });

    const output = formatVersionList({
      packageName: "test-pkg",
      packument,
      registryUrl: "https://reg.example",
      downloadCommand: "nori-skillsets download",
    });

    expect(output).toBe(
      [
        'Available versions of "test-pkg" from https://reg.example:\n',
        "Dist-tags:",
        "  latest: 2.0.0",
        "  beta: 2.1.0-beta.1",
        "\nVersions:",
        `  2.1.0-beta.1 (beta) - ${localeDate({ iso: "2024-04-01T00:00:00.000Z" })}`,
        `  2.0.0 (latest) - ${localeDate({ iso: "2024-03-01T00:00:00.000Z" })}`,
        `  1.0.0 - ${localeDate({ iso: "2024-01-01T00:00:00.000Z" })}`,
        "\nTo download a specific version:\n  nori-skillsets download test-pkg@<version>",
      ].join("\n"),
    );
  });

  it("omits timestamps for versions without time entries", () => {
    const packument = makePackument({
      name: "no-time",
      distTags: { latest: "1.0.0" },
      versions: ["1.0.0"],
    });

    const output = formatVersionList({
      packageName: "no-time",
      packument,
      registryUrl: "https://reg.example",
      downloadCommand: "sks download-skill",
    });

    expect(output).toContain("  1.0.0 (latest)");
    expect(output).not.toContain(" - ");
    expect(output).toContain(
      "\nTo download a specific version:\n  sks download-skill no-time@<version>",
    );
  });
});

describe("formatMultipleMatchesError", () => {
  it("lists each registry match and the --registry download commands", () => {
    const results = [
      {
        registryUrl: "https://a.example",
        packument: makePackument({
          name: "dup-pkg",
          distTags: { latest: "1.0.0" },
          versions: ["1.0.0"],
          description: "First package",
        }),
      },
      {
        registryUrl: "https://b.example",
        packument: makePackument({
          name: "dup-pkg",
          distTags: {},
          versions: ["2.0.0"],
        }),
      },
    ];

    const output = formatMultipleMatchesError({
      packageName: "dup-pkg",
      results,
      entityLabel: "skills",
      downloadCommand: "nori-skillsets download-skill",
    });

    expect(output).toBe(
      [
        "Multiple skills with the same name found.\n",
        "https://a.example",
        "  -> dup-pkg@1.0.0: First package\n",
        "https://b.example",
        "  -> dup-pkg@unknown: \n",
        "To download, please specify the registry with --registry:",
        "nori-skillsets download-skill dup-pkg --registry https://a.example",
        "nori-skillsets download-skill dup-pkg --registry https://b.example",
      ].join("\n"),
    );
  });
});

describe("searchSpecificRegistry", () => {
  const packument = makePackument({ name: "test-pkg" });

  it("fetches from the public registry without auth", async () => {
    const fetchPackument = vi.fn().mockResolvedValue(packument);
    const getAuthToken = vi.fn().mockResolvedValue("unused");

    const outcome = await searchSpecificRegistry({
      registryUrl: REGISTRAR_URL,
      fetchPackument,
      getAuthToken,
    });

    expect(outcome).toEqual({
      result: { registryUrl: REGISTRAR_URL, packument },
      error: null,
    });
    expect(fetchPackument).toHaveBeenCalledWith({ registryUrl: REGISTRAR_URL });
    expect(getAuthToken).not.toHaveBeenCalled();
  });

  it("reports network errors from the public registry", async () => {
    const fetchPackument = vi
      .fn()
      .mockRejectedValue(
        new NetworkError("connection refused", "ECONNREFUSED"),
      );

    const outcome = await searchSpecificRegistry({
      registryUrl: REGISTRAR_URL,
      fetchPackument,
      getAuthToken: null,
    });

    expect(outcome).toEqual({
      result: null,
      error: {
        registryUrl: REGISTRAR_URL,
        isNetworkError: true,
        message: "connection refused",
      },
    });
  });

  it("treats API errors from the public registry as not found", async () => {
    const fetchPackument = vi.fn().mockRejectedValue(new Error("404"));

    const outcome = await searchSpecificRegistry({
      registryUrl: REGISTRAR_URL,
      fetchPackument,
      getAuthToken: null,
    });

    expect(outcome).toEqual({ result: null, error: null });
  });

  it("returns not found for a private registry without auth", async () => {
    const fetchPackument = vi.fn();

    const outcome = await searchSpecificRegistry({
      registryUrl: "https://private.example",
      fetchPackument,
      getAuthToken: null,
    });

    expect(outcome).toEqual({ result: null, error: null });
    expect(fetchPackument).not.toHaveBeenCalled();
  });

  it("fetches from a private registry with the resolved auth token", async () => {
    const fetchPackument = vi.fn().mockResolvedValue(packument);
    const getAuthToken = vi.fn().mockResolvedValue("tok-123");

    const outcome = await searchSpecificRegistry({
      registryUrl: "https://private.example",
      fetchPackument,
      getAuthToken,
    });

    expect(outcome).toEqual({
      result: {
        registryUrl: "https://private.example",
        packument,
        authToken: "tok-123",
      },
      error: null,
    });
    expect(fetchPackument).toHaveBeenCalledWith({
      registryUrl: "https://private.example",
      authToken: "tok-123",
    });
  });

  it("reports network errors from a private registry", async () => {
    const fetchPackument = vi
      .fn()
      .mockRejectedValue(new NetworkError("timed out", "ETIMEDOUT"));
    const getAuthToken = vi.fn().mockResolvedValue("tok-123");

    const outcome = await searchSpecificRegistry({
      registryUrl: "https://private.example",
      fetchPackument,
      getAuthToken,
    });

    expect(outcome).toEqual({
      result: null,
      error: {
        registryUrl: "https://private.example",
        isNetworkError: true,
        message: "timed out",
      },
    });
  });

  it("treats auth or API errors from a private registry as not found", async () => {
    const fetchPackument = vi.fn();
    const getAuthToken = vi.fn().mockRejectedValue(new Error("bad refresh"));

    const outcome = await searchSpecificRegistry({
      registryUrl: "https://private.example",
      fetchPackument,
      getAuthToken,
    });

    expect(outcome).toEqual({ result: null, error: null });
    expect(fetchPackument).not.toHaveBeenCalled();
  });
});
