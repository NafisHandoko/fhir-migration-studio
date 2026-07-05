# FHIR Migration Studio

> Production-grade desktop application for migrating HL7 FHIR resources between different FHIR servers.

---

## Overview

FHIR Migration Studio is an engineering tool designed to simplify data migration between healthcare systems that implement the HL7 FHIR standard.

Instead of manually exporting, editing, and importing FHIR resources, this application provides a guided migration workflow with automatic dependency analysis, identifier mapping, validation, and reporting.

The application is intended for:

- Hospitals
- Healthcare Software Vendors
- System Integrators
- Healthcare IT Engineers

---

## Features

### Direct Server Migration

Connect two FHIR servers and migrate resources directly without manually exporting and importing files.

Workflow:

```

Source Server

↓

Scan Resources

↓

Analyze Dependencies

↓

Generate Mapping

↓

Rewrite References

↓

Transaction Bundle

↓

Destination Server

↓

Validation

↓

Migration Report

```

---

### Excel Import

Import historical medical records exported from legacy EMR systems.

Supports:

- Patient
- Appointment
- Encounter
- Composition
- Observation
- Condition

---

### FHIR Export

Export selected FHIR resources into NDJSON format for:

- Backup
- Disaster Recovery
- Offline Migration

---

### FHIR Import

Restore previously exported NDJSON backups into another FHIR server.

---

### Resource Mapping

Automatically match resources using business identifiers.

Examples:

Patient

- NIK
- Medical Record Number

Practitioner

- SIP

Location

- Identifier

HealthcareService

- Identifier

Manual mapping is available when automatic matching fails.

---

### Validation

Before migration:

- Broken references
- Duplicate identifiers
- Missing resources
- Invalid Bundle

After migration:

- Resource count
- Missing references
- Validation report

---

### FHIR Explorer

Browse resources directly from connected servers.

Features:

- Search
- Pagination
- JSON Viewer
- Resource Inspector

---

## Technology

Frontend

- React
- TypeScript
- TailwindCSS
- shadcn/ui

Desktop

- Tauri v2

State Management

- Zustand
- TanStack Query

Forms

- React Hook Form
- Zod

Animation

- Framer Motion

---

## Architecture

The project follows a layered architecture.

```

UI

↓

Application Layer

↓

Migration Engine

↓

FHIR Services

↓

Network Layer

```

Business logic is isolated from the UI.

---

## Documentation

See the documentation inside:

```

docs/

```

---

## Current Status

🚧 Under Development

---

## License

Private