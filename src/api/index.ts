import { analyticsApi } from "@/api/analytics.js";
import { artifactsApi } from "@/api/artifacts.js";
import { apiRequest } from "@/api/base.js";
import { conversationApi } from "@/api/conversation.js";
import { queryApi } from "@/api/query.js";
import { registrarApi } from "@/api/registrar.js";

/**
 * Response from handshake endpoint
 */
export type HandshakeResponse = {
  success: boolean;
  user: string;
  message: string;
};

/**
 * Test authentication with server
 * @returns Handshake response with user info
 */
export const handshake = async (): Promise<HandshakeResponse> => {
  return await apiRequest<HandshakeResponse>({
    path: "/auth/handshake",
    method: "POST",
  });
};

export const apiClient = {
  analytics: analyticsApi,
  artifacts: artifactsApi,
  conversation: conversationApi,
  query: queryApi,
  registrar: registrarApi,
  handshake,
};

export type { Artifact } from "@/api/artifacts.js";
export type { QueryResponse, QueryRequest } from "@/api/query.js";
export type {
  SummarizeRequest,
  SummarizeResponse,
} from "@/api/conversation.js";
export { ConfigManager } from "@/api/base.js";
export type {
  Package,
  Packument,
  SearchPackagesRequest,
  GetPackumentRequest,
  DownloadTarballRequest,
} from "@/api/registrar.js";
