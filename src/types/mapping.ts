/**
 * Reference mapping types.
 *
 * A MappingRule tells the mapper to replace a reference
 * from an old server resource ID with the corresponding
 * ID on the new (target) server.
 *
 * Example use case: Practitioner/old-id → Practitioner/new-id
 */

import type { FhirResourceType } from './fhir';

export type MappableResourceType = 'Practitioner' | 'Location' | 'HealthcareService' | 'Organization';

export const MAPPABLE_RESOURCE_TYPES: MappableResourceType[] = [
  'Practitioner',
  'Location',
  'HealthcareService',
  'Organization',
];

export interface MappingRule {
  id: string;
  /** The resource type this rule applies to */
  resourceType: MappableResourceType;
  /** The resource ID on the source (old) server */
  sourceId: string;
  /** The resource ID on the target (new) server */
  targetId: string;
  /** Human-readable label for display in the UI */
  label?: string;
}

/** Summary of what the mapper found during reference analysis */
export interface ReferenceAnalysis {
  /** References that have a mapping rule defined */
  mapped: Array<{ resourceType: FhirResourceType; reference: string; targetReference: string }>;
  /** References that have NO mapping rule — will be left as-is */
  unmapped: Array<{ resourceType: FhirResourceType; reference: string }>;
}
