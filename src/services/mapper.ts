/**
 * Mapper — rewrites FHIR resource references according to user-defined mapping rules.
 *
 * Handles manually-mapped resources that already exist on the destination server:
 *   Practitioner, Location, HealthcareService, Organization
 *
 * Walks the resource JSON tree recursively via the shared referenceRewriter utility.
 * Any "reference" field matching "ResourceType/oldId" is rewritten to
 * "ResourceType/targetId" using the user-defined MappingRule list.
 *
 * This step runs BEFORE either Phase 1 or Phase 2 bundle construction.
 */

import type { FhirResource } from '../types/fhir';
import type { MappingRule } from '../types/mapping';
import { rewriteRefsInNode } from './referenceRewriter';
import { log } from '../store/logStore';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a lookup map from "ResourceType/sourceId" → "ResourceType/targetId"
 * from the list of user-defined MappingRules.
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

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

/**
 * Rewrite all references in a FHIR resource according to the provided rules.
 * Returns a new resource object — the original is not mutated.
 *
 * Logs a summary of every rewrite performed for audit purposes.
 */
export function rewriteReferences(
  resource: FhirResource,
  rules: MappingRule[],
): FhirResource {
  if (rules.length === 0) return resource;

  const lookup = buildLookup(rules);

  // Track which references were actually changed so we can log them
  const rewrites: string[] = [];
  const trackingMap = new Map<string, string>();
  for (const [from, to] of lookup.entries()) {
    trackingMap.set(from, to);
  }

  // Use the shared rewriter
  const rewritten = rewriteRefsInNode(resource, trackingMap) as FhirResource;

  // Detect rewrites by comparing original vs rewritten at the reference level
  // (lightweight: just check whether any field changed)
  if (JSON.stringify(resource) !== JSON.stringify(rewritten)) {
    // Collect changed refs for the log
    collectChangedRefs(resource, rewritten, rewrites);

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

/** Walk two parallel trees and collect "original → new" strings for changed refs. */
function collectChangedRefs(original: unknown, rewritten: unknown, out: string[]): void {
  if (!original || !rewritten || typeof original !== 'object' || typeof rewritten !== 'object') return;

  if (Array.isArray(original) && Array.isArray(rewritten)) {
    for (let i = 0; i < original.length; i++) {
      collectChangedRefs(original[i], rewritten[i], out);
    }
    return;
  }

  const orig = original as Record<string, unknown>;
  const rew = rewritten as Record<string, unknown>;

  for (const key of Object.keys(orig)) {
    if (key === 'reference' && typeof orig[key] === 'string' && orig[key] !== rew[key]) {
      out.push(`${orig[key]} → ${rew[key]}`);
    } else {
      collectChangedRefs(orig[key], rew[key], out);
    }
  }
}

// ---------------------------------------------------------------------------
// Reference Analysis (used by the UI before migration starts)
// ---------------------------------------------------------------------------

export interface ReferenceAnalysisResult {
  mapped: Array<{ ref: string; replacement: string; resourceId?: string }>;
  unmapped: Array<{ ref: string; resourceId?: string }>;
}

/**
 * Analyze references in a set of resources to identify which are covered by
 * the provided mapping rules and which are not.
 * Used by the UI to warn users before migration.
 */
export function analyzeReferences(
  resources: FhirResource[],
  rules: MappingRule[],
): ReferenceAnalysisResult {
  const lookup = buildLookup(rules);
  const mapped: ReferenceAnalysisResult['mapped'] = [];
  const unmapped: ReferenceAnalysisResult['unmapped'] = [];

  const MAPPABLE_PREFIXES = ['Practitioner/', 'Location/', 'HealthcareService/', 'Organization/'];

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
        const isMappable = MAPPABLE_PREFIXES.some((prefix) => ref.startsWith(prefix));
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
