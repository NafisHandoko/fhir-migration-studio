/**
 * Mapper — rewrites FHIR resource references according to mapping rules.
 *
 * Walks the resource JSON tree recursively. Any object with a "reference"
 * string field that matches "ResourceType/oldId" will have its ID replaced
 * with the target ID from the matching MappingRule.
 */

import type { FhirResource } from '../types/fhir';
import type { MappingRule } from '../types/mapping';
import { log } from '../store/logStore';

/**
 * Build a lookup map from "ResourceType/sourceId" → "ResourceType/targetId"
 */
function buildLookup(rules: MappingRule[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const rule of rules) {
    map.set(
      `${rule.resourceType}/${rule.sourceId}`,
      `${rule.resourceType}/${rule.targetId}`,
    );
  }
  return map;
}

/**
 * Recursively walk a JSON object/array and rewrite any "reference" field
 * values that match a mapping rule.
 */
function rewriteNode(
  node: unknown,
  lookup: Map<string, string>,
  rewrites: string[],
): unknown {
  if (node === null || node === undefined) return node;

  if (Array.isArray(node)) {
    return node.map((item) => rewriteNode(item, lookup, rewrites));
  }

  if (typeof node === 'object') {
    const obj = node as Record<string, unknown>;
    const result: Record<string, unknown> = {};

    for (const key of Object.keys(obj)) {
      if (key === 'reference' && typeof obj[key] === 'string') {
        const originalRef = obj[key] as string;
        const replacement = lookup.get(originalRef);
        if (replacement) {
          result[key] = replacement;
          rewrites.push(`${originalRef} → ${replacement}`);
        } else {
          result[key] = originalRef;
        }
      } else {
        result[key] = rewriteNode(obj[key], lookup, rewrites);
      }
    }

    return result;
  }

  return node;
}

/**
 * Rewrite all references in a FHIR resource according to the provided rules.
 * Returns a new resource object — the original is not mutated.
 */
export function rewriteReferences(
  resource: FhirResource,
  rules: MappingRule[],
): FhirResource {
  if (rules.length === 0) return resource;

  const lookup = buildLookup(rules);
  const rewrites: string[] = [];
  const rewritten = rewriteNode(resource, lookup, rewrites) as FhirResource;

  if (rewrites.length > 0) {
    log({
      level: 'info',
      message: `Rewrote ${rewrites.length} reference(s) in ${resource.resourceType}/${resource.id}`,
      resourceType: resource.resourceType,
      resourceId: resource.id,
      detail: rewrites.join(', '),
    });
  }

  return rewritten;
}

/**
 * Analyze references in a set of resources to identify mapped vs unmapped.
 * Used by the UI to warn users before migration.
 */
export interface ReferenceAnalysisResult {
  mapped: Array<{ ref: string; replacement: string; resourceId?: string }>;
  unmapped: Array<{ ref: string; resourceId?: string }>;
}

export function analyzeReferences(
  resources: FhirResource[],
  rules: MappingRule[],
): ReferenceAnalysisResult {
  const lookup = buildLookup(rules);
  const mapped: ReferenceAnalysisResult['mapped'] = [];
  const unmapped: ReferenceAnalysisResult['unmapped'] = [];

  const collectRefs = (node: unknown, resourceId?: string): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach((item) => collectRefs(item, resourceId));
      return;
    }
    const obj = node as Record<string, unknown>;
    for (const key of Object.keys(obj)) {
      if (key === 'reference' && typeof obj[key] === 'string') {
        const ref = obj[key] as string;
        // Only analyze references that are to mappable resource types
        const isMappable = ['Practitioner/', 'Location/', 'HealthcareService/'].some((prefix) =>
          ref.startsWith(prefix),
        );
        if (isMappable) {
          const replacement = lookup.get(ref);
          if (replacement) {
            mapped.push({ ref, replacement, resourceId });
          } else {
            unmapped.push({ ref, resourceId });
          }
        }
      } else {
        collectRefs(obj[key], resourceId);
      }
    }
  };

  for (const resource of resources) {
    collectRefs(resource, resource.id);
  }

  return { mapped, unmapped };
}
