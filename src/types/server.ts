/**
 * Server connection configuration types.
 *
 * Auth: optional Bearer token.
 * Tenant: optional X-Tenant-Id header value.
 */

export type ServerRole = 'source' | 'target';

export interface ServerAuth {
  token: string; // Bearer token
}

export interface ServerConfig {
  id: string;
  name: string;
  baseUrl: string;
  /** Optional Bearer token. If absent, requests are made without Authorization header. */
  auth?: ServerAuth;
  /** Optional tenant identifier sent as X-Tenant-Id header. If absent, header is omitted. */
  tenantId?: string;
}

export type ConnectionState = 'idle' | 'testing' | 'connected' | 'error';

export interface ConnectionStatus {
  state: ConnectionState;
  fhirVersion?: string;
  serverName?: string;
  error?: string;
  testedAt?: string;
}

export function createDefaultServerConfig(role: ServerRole): ServerConfig {
  return {
    id: role,
    name: role === 'source' ? 'Source Server' : 'Target Server',
    baseUrl: '',
    auth: undefined,
    tenantId: undefined,
  };
}
