/**
 * Uploader — POSTs Transaction Bundles to the target server.
 * Includes retry logic with exponential backoff.
 */

import { fhirClient, FhirClientError } from './fhirClient';
import { log } from '../store/logStore';
import type { ServerConfig } from '../types/server';
import type { Bundle } from '../types/fhir';
import type { FhirResourceType } from '../types/fhir';

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

export interface UploadResult {
  success: number;
  failed: number;
  total: number;
  errors: string[];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Upload a single Transaction Bundle to the target server.
 * Returns the raw response Bundle (transaction-response type).
 * Retries up to MAX_RETRIES times on transient errors (5xx).
 */
export async function uploadSingleBundle(
  config: ServerConfig,
  bundle: Bundle,
  attempt = 1,
): Promise<Bundle> {
  try {
    return await fhirClient.post<Bundle>(config, '/', bundle);
  } catch (err) {
    const isRetryable =
      err instanceof FhirClientError &&
      err.status !== undefined &&
      err.status >= 500;

    if (isRetryable && attempt < MAX_RETRIES) {
      const delay = RETRY_DELAY_MS * Math.pow(2, attempt - 1);
      log({ level: 'warn', message: `Upload failed (attempt ${attempt}), retrying in ${delay}ms...` });
      await sleep(delay);
      return uploadSingleBundle(config, bundle, attempt + 1);
    }

    throw err;
  }
}

/**
 * Count successes and failures from a transaction-response Bundle.
 */
function parseResponse(responseBundle: Bundle): { success: number; failed: number; errors: string[] } {
  const entries = responseBundle.entry ?? [];
  let success = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const entry of entries) {
    const status = entry.response?.status ?? '';
    const code = parseInt(status.split(' ')[0], 10);
    if (code >= 200 && code < 300) {
      success++;
    } else {
      failed++;
      errors.push(`Entry ${entry.fullUrl ?? '?'}: ${status}`);
    }
  }

  return { success, failed, errors };
}

/**
 * Upload multiple bundles sequentially, reporting progress per bundle.
 */
export async function uploadBundles(
  config: ServerConfig,
  bundles: Bundle[],
  resourceType: FhirResourceType,
  onProgress: (result: UploadResult) => void,
  shouldContinue?: () => boolean,
): Promise<UploadResult> {
  const aggregate: UploadResult = { success: 0, failed: 0, total: 0, errors: [] };

  for (let i = 0; i < bundles.length; i++) {
    if (shouldContinue && !shouldContinue()) {
      log({ level: 'warn', message: `Upload aborted: ${resourceType}`, resourceType });
      break;
    }
    const bundle = bundles[i];
    const bundleSize = bundle.entry?.length ?? 0;
    aggregate.total += bundleSize;

    try {
      log({
        level: 'info',
        message: `Uploading ${resourceType} bundle ${i + 1}/${bundles.length} (${bundleSize} resources)`,
        resourceType,
      });

      const responseBundle = await uploadSingleBundle(config, bundle);
      const { success, failed, errors } = parseResponse(responseBundle);

      aggregate.success += success;
      aggregate.failed += failed;
      aggregate.errors.push(...errors);

      log({
        level: failed > 0 ? 'warn' : 'success',
        message: `Bundle ${i + 1}/${bundles.length}: ${success} ok, ${failed} failed`,
        resourceType,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      aggregate.failed += bundleSize;
      aggregate.errors.push(`Bundle ${i + 1}: ${msg}`);

      log({
        level: 'error',
        message: `Bundle ${i + 1}/${bundles.length} upload failed: ${msg}`,
        resourceType,
      });
    }

    onProgress({ ...aggregate });
  }

  return aggregate;
}
