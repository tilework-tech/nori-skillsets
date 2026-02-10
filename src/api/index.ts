import { analyticsApi } from "@/api/analytics.js";
import { apiRequest } from "@/api/base.js";
import { registrarApi } from "@/api/registrar.js";
import { transcriptApi } from "@/api/transcript.js";

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
  registrar: registrarApi,
  transcript: transcriptApi,
  handshake,
};

export { ConfigManager } from "@/api/base.js";
export type {
  Package,
  Packument,
  SearchPackagesRequest,
  GetPackumentRequest,
  DownloadTarballRequest,
  UploadSkillsetRequest,
  UploadSkillsetResponse,
} from "@/api/registrar.js";
export type {
  TranscriptMessage,
  UploadTranscriptRequest,
  UploadTranscriptResponse,
} from "@/api/transcript.js";
