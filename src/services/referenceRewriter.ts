/**
 * Reference Rewriter — single source of truth for recursive FHIR reference rewriting.
 *
 * Previously the same tree-walk logic was duplicated in mapper.ts (rewriteNode)
 * and bundleBuilder.ts (rewriteRefsInNode). This module consolidates them so
 * every change to the rewriting logic only needs to happen in one place.
 */

import type { FhirResource } from '../types/fhir';

/**
 * Recursively walk a JSON value and rewrite any "reference" string using refMap.
 * Does NOT mutate the input — returns a new deep copy.
 *
 * @param node   Any JSON-compatible value
 * @param refMap Map<originalRef, newRef> — only keys present in the map are rewritten
 */
export function rewriteRefsInNode(node: unknown, refMap: ReadonlyMap<string, string>): unknown {
  if (node === null || node === undefined) return node;

  if (Array.isArray(node)) {
    return node.map((item) => rewriteRefsInNode(item, refMap));
  }

  if (typeof node === 'object') {
    const obj = node as Record<string, unknown>;
    const result: Record<string, unknown> = {};

    for (const key of Object.keys(obj)) {
      if (key === 'reference' && typeof obj[key] === 'string') {
        const orig = obj[key] as string;
        result[key] = refMap.get(orig) ?? orig;
      } else {
        result[key] = rewriteRefsInNode(obj[key], refMap);
      }
    }

    return result;
  }

  return node;
}

/**
 * Rewrite all reference fields inside a FHIR resource using refMap.
 * Returns a new resource — the original is NOT mutated.
 */
export function rewriteResourceRefs(
  resource: FhirResource,
  refMap: ReadonlyMap<string, string>,
): FhirResource {
  return rewriteRefsInNode(resource, refMap) as FhirResource;
}
