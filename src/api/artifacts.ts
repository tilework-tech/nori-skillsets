import { apiRequest } from "@/api/base.js";

export type ArtifactType =
  | "transcript"
  | "summary"
  | "recipe"
  | "webhook"
  | "memory"
  | "premortem"
  | "no-type";

export type Artifact = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  content: string;
  sourceUrl?: string | null;
  userEmail?: string | null;
  type: ArtifactType;
  repository: string;
};

export type CreateArtifactRequest = {
  name: string;
  content: string;
  summary?: string | null;
  sourceUrl?: string | null;
  type?: ArtifactType | null;
};

export const artifactsApi = {
  create: async (args: CreateArtifactRequest): Promise<Artifact> => {
    const { name, content, sourceUrl, type } = args;

    return apiRequest<Artifact>({
      path: "/artifacts",
      method: "POST",
      body: {
        name,
        content,
        sourceUrl,
        type,
        actor: "claude-code", // MCP always acts as claude-code
      },
    });
  },

  get: async (args: { id: string }): Promise<Artifact> => {
    const { id } = args;

    return apiRequest<Artifact>({
      path: `/artifacts/${id}`,
      method: "GET",
      queryParams: { actor: "claude-code" },
    });
  },
};
