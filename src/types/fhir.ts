/**
 * FHIR DSTU3 resource types used in FHIR Migration Studio.
 * Only includes types relevant to migration — not a complete FHIR SDK.
 */

export type FhirResourceType =
  | 'Patient'
  | 'Appointment'
  | 'Encounter'
  | 'Composition'
  | 'Condition'
  | 'Observation'
  | 'AllergyIntolerance'
  | 'ClinicalImpression'
  | 'MedicationRequest'
  | 'MedicationDispense'
  | 'Procedure'
  | 'ProcedureRequest'
  | 'Coverage'
  | 'Practitioner'
  | 'Location'
  | 'HealthcareService';

export const MIGRATABLE_RESOURCE_TYPES: FhirResourceType[] = [
  'Patient',
  'Appointment',
  'Encounter',
  'Composition',
  'Condition',
  'Observation',
  'AllergyIntolerance',
  'ClinicalImpression',
  'MedicationRequest',
  'MedicationDispense',
  'Procedure',
  'ProcedureRequest',
  'Coverage'
];

export const REFERENCE_RESOURCE_TYPES: FhirResourceType[] = [
  'Practitioner',
  'Location',
  'HealthcareService',
];

export interface Reference {
  reference?: string;
  display?: string;
  identifier?: Identifier;
}

export interface Identifier {
  system?: string;
  value?: string;
  use?: string;
}

export interface Coding {
  system?: string;
  code?: string;
  display?: string;
}

export interface CodeableConcept {
  coding?: Coding[];
  text?: string;
}

export interface Period {
  start?: string;
  end?: string;
}

export interface Narrative {
  status: string;
  div: string;
}

export interface Meta {
  versionId?: string;
  lastUpdated?: string;
  profile?: string[];
  tag?: Coding[];
}

/** Base interface for all FHIR resources */
export interface FhirResource {
  resourceType: FhirResourceType;
  id?: string;
  meta?: Meta;
  text?: Narrative;
  identifier?: Identifier[];
  [key: string]: unknown;
}

/** FHIR Bundle resource */
export interface Bundle {
  resourceType: 'Bundle';
  id?: string;
  meta?: Meta;
  type: 'searchset' | 'transaction' | 'transaction-response' | 'batch' | 'batch-response' | 'collection';
  total?: number;
  link?: BundleLink[];
  entry?: BundleEntry[];
}

export interface BundleLink {
  relation: string;
  url: string;
}

export interface BundleEntry {
  fullUrl?: string;
  resource?: FhirResource;
  request?: BundleEntryRequest;
  response?: BundleEntryResponse;
}

export interface BundleEntryRequest {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  url: string;
}

export interface BundleEntryResponse {
  status: string;
  location?: string;
  etag?: string;
  lastModified?: string;
}

/** FHIR CapabilityStatement (for connection testing) */
export interface CapabilityStatement {
  resourceType: 'CapabilityStatement';
  fhirVersion?: string;
  software?: {
    name?: string;
    version?: string;
  };
  implementation?: {
    description?: string;
    url?: string;
  };
}
