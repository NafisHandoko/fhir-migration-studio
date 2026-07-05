/**
 * FHIR HTTP Client.
 *
 * Wraps fetch with:
 * - Optional Bearer token Authorization header
 * - Optional X-Tenant-Id header
 * - JSON content type for POST requests
 *
 * Uses the native browser fetch API (works in Tauri webview for same-network requests).
 * If you encounter CORS issues with the FHIR server, enable Tauri's http plugin.
 */

import type { ServerConfig } from '../types/server';
import type { Bundle, CapabilityStatement, FhirResource } from '../types/fhir';
import { log } from '../store/logStore';

export class FhirClientError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly body?: string,
  ) {
    super(message);
    this.name = 'FhirClientError';
  }
}

function buildHeaders(config: ServerConfig): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/fhir+json',
    'Content-Type': 'application/fhir+json',
  };

  if (config.auth?.token) {
    headers['Authorization'] = `Bearer ${config.auth.token}`;
  }

  if (config.tenantId) {
    headers['X-Tenant-Id'] = config.tenantId;
  }

  return headers;
}

function normalizeBaseUrl(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

async function handleResponse<T>(response: Response, context: string): Promise<T> {
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new FhirClientError(
      `${context} failed: HTTP ${response.status} ${response.statusText}`,
      response.status,
      body,
    );
  }
  return response.json() as Promise<T>;
}

export const fhirClient = {
  /**
   * GET a FHIR resource or search result.
   * @param config Server configuration
   * @param path Path relative to base URL (e.g. "/Patient?_count=50")
   */
  async get<T = FhirResource>(config: ServerConfig, path: string): Promise<T> {
    const base = normalizeBaseUrl(config.baseUrl);
    const url = `${base}${path}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: buildHeaders(config),
    });
    return handleResponse<T>(response, `GET ${path}`);
  },

  /**
   * POST a FHIR resource or Transaction Bundle.
   */
  async post<T = FhirResource>(config: ServerConfig, path: string, body: unknown): Promise<T> {
    const base = normalizeBaseUrl(config.baseUrl);
    const url = `${base}${path}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: buildHeaders(config),
      body: JSON.stringify(body),
    });
    return handleResponse<T>(response, `POST ${path}`);
  },

  /**
   * Test connectivity by reading the CapabilityStatement (metadata endpoint).
   * Returns the FHIR version string on success.
   */
  async testConnection(config: ServerConfig): Promise<CapabilityStatement> {
    log({ level: 'info', message: `Testing connection to ${config.baseUrl}` });
    try {
      const cs = await fhirClient.get<CapabilityStatement>(config, '/metadata');
      log({ level: 'success', message: `Connected to ${config.name} (FHIR ${cs.fhirVersion ?? 'unknown'})` });
      return cs;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log({ level: 'error', message: `Connection failed: ${msg}` });
      throw err;
    }
  },

  /**
   * Search a resource type with optional query params.
   * Returns the full Bundle (searchset).
   */
  async search(
    config: ServerConfig,
    resourceType: string,
    params: Record<string, string> = {},
  ): Promise<Bundle> {
    const qs = new URLSearchParams(params).toString();
    const path = `/${resourceType}${qs ? `?${qs}` : ''}`;
    return fhirClient.get<Bundle>(config, path);
  },

  /**
   * Fetch the next page of a search result using the Bundle's next link.
   */
  async nextPage(config: ServerConfig, nextUrl: string): Promise<Bundle> {
    const base = normalizeBaseUrl(config.baseUrl);
    // nextUrl may be absolute or relative
    const url = nextUrl.startsWith('http') ? nextUrl : `${base}${nextUrl}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: buildHeaders(config),
    });
    return handleResponse<Bundle>(response, `GET next page`);
  },
};
