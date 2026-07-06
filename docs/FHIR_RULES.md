# FHIR Rules

# Goal

Refactor the FHIR migration process to avoid HTTP 413 (Content Too Large) while preserving transactional integrity.

The current implementation builds one massive FHIR Transaction Bundle (~15,000 resources), which exceeds the server request size limit.

The new implementation should split the migration into multiple smaller Transaction Bundles without breaking any FHIR references.

---

# Current Architecture

The destination server already contains and maps:

* Practitioner
* Location
* HealthcareService
* Organization

The migration imports:

* Patient
* Coverage
* Appointment
* Encounter
* Composition
* Condition
* Observation
* AllergyIntolerance
* ClinicalImpression
* MedicationRequest
* MedicationDispense
* Procedure
* ProcedureRequest
* Consent
* AuditEvent
* Questionnaire
* Schedule
* Slot

---

# Resource Relationships

## Patient

A Patient may have:

* one or more Coverages
* multiple Appointments
* links to other Patient resources via `Patient.link.other`

## Appointment

References:

* Patient
* Practitioner
* Slot
* HealthcareService

One Appointment may produce one or more Encounters.

## Encounter

References:

* Appointment
* Patient
* Condition

Each Encounter produces exactly one Composition.

## Composition

References:

* Encounter
* Patient
* Practitioner
* Condition
* Observation
* AllergyIntolerance
* ClinicalImpression
* MedicationRequest
* MedicationDispense
* Procedure
* ProcedureRequest

## Other Resources

MedicationDispense references MedicationRequest.

Clinical resources (Condition, Observation, Procedure, MedicationRequest, etc.) belong only to a single Composition.

Clinical resources never reference clinical resources belonging to another patient.

The only cross-patient relationship is `Patient.link.other`.

---

# Migration Strategy

Do NOT build one giant Transaction Bundle.

Instead, split the migration into multiple small Transaction Bundles.

---

# Phase 1 — Shared Resources

Create shared resources first.

This includes:

* Patient
* Coverage
* Schedule
* Slot
* Questionnaire

Use Transaction Bundles.

Bundle size must be configurable (for example 100–500 resources).

After each successful Transaction:

Store

Old Resource ID

↓

New Resource ID

Example

Patient/100

↓

Patient/987

This mapping will be used later to rewrite references.

---

# Patient.link.other Handling

Because Patient resources may reference other Patient resources, migrate them in two steps.

Step 1

Create every Patient without `Patient.link.other`.

Step 2

After every Patient has been created and all Patient ID mappings are available,

update each Patient and restore `Patient.link.other` using the mapped destination Patient IDs.

Do NOT force every related Patient into the same Transaction Bundle.

---

# Phase 2 — Clinical Episode Transactions

Instead of grouping resources by resource type, group them by clinical episode.

One Appointment should produce one or more small Transaction Bundles.

Each Transaction Bundle should contain resources belonging to one Encounter.

Example:

* Appointment (only if not yet created)
* Encounter
* Composition
* Condition
* Observation
* AllergyIntolerance
* ClinicalImpression
* Procedure
* ProcedureRequest
* MedicationRequest
* MedicationDispense
* Consent (if present)
* AuditEvent (if present)

The objective is to keep each Transaction Bundle small while preserving atomicity for one clinical episode.

---

# UUID Strategy

Continue using `urn:uuid`.

Do NOT remove UUID references.

However, UUIDs should only exist inside a single Transaction Bundle.

Resources created together inside one Transaction should reference each other using `urn:uuid`.

Examples:

Appointment

↓

Encounter

↓

Composition

↓

Observation

should continue using UUID references.

UUIDs must never be expected to work across multiple Transaction Bundles.

---

# Reference Rewriting

Before creating each Transaction Bundle:

Rewrite every reference that points to an already migrated shared resource.

Examples:

Patient

Practitioner

Location

HealthcareService

Organization

Schedule

Slot

Coverage (if applicable)

must all be rewritten using the destination IDs stored in the mapping table.

Do NOT rewrite references between resources that are being created inside the same Transaction Bundle.

Those references should continue using `urn:uuid`.

---

# Architecture Requirements

Separate responsibilities into independent components.

Suggested components:

* Migration Orchestrator
* Shared Resource Migrator
* Clinical Episode Builder
* Transaction Bundle Builder
* Resource Mapping Service
* Reference Rewriter

The implementation should avoid duplicated reference rewriting logic.

---

# Configuration

Bundle size must be configurable.

The implementation should allow changing the maximum number of resources per Transaction Bundle without changing business logic.

---

# Expected Result

The final solution should:

* eliminate HTTP 413 errors
* keep using Transaction Bundles
* preserve atomicity within each clinical episode
* preserve all FHIR references correctly
* continue using `urn:uuid` where appropriate
* rewrite only references that cross Transaction Bundle boundaries
* support Patient self-references via `Patient.link.other`
* make retrying failed batches easy
* keep the implementation modular, maintainable, and extensible
