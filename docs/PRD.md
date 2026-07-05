# PRD

## Goal
Desktop application to migrate HL7 FHIR resources between FHIR servers.

## Features
- Direct Server → Server migration
- Excel → FHIR
- FHIR → NDJSON
- NDJSON → FHIR
- Resource mapping
- Validation
- Logs

## Users
Healthcare IT engineers and implementors.

--------------------------------

# First prompt (main prompt to run)

masalah utama:
kami membuat server baru dan telah memasukkan practitioner, location, dan healthcareservice di server baru, namun resource-resource fhir yang lain yaitu data-data pasien berserta data-data rekam medis belum tersedia di server baru dan hanya tersedia di server lama. data-data fhir yang perlu dicopy dari server lama ke server baru yaitu meliputi
- Patient
- Appointment
- Encounter
- Composition
- Condition
- Observation
- AllergyIntolerance
- ClinicalImpression
- MedicationRequest
- MedicationDispense
- Procedure
- ProcedureRequest

saat get data fhir dari server lama, tiap-tiap resource tersebut diantaranya mungkin akan depend ke id practitioner, location, atau healthcareservice dari server lama juga padahal di server baru sudah ada namun id nya pasti baru. di aplikasi ini user harus capable untuk memasukkan data-data reference dari server baru untuk replace reference di data fhir dari server lama, semacam mapping, contohnya untuk kasus seperti practitioner, location, dan healthcareservice tadi. user juga capable untuk memasukkan tenant id pada server yang terkoneksi entah itu server lama atau baru yang nantinya diletakkan pada header "X-Tenant-Id" pada tiap request ke server tersebut. request tidak menggunakan X-Tenant-Id jika user tidak memasukkan tenant id.

tujuan utama dari aplikasi ini adalah untuk memecahkan masalah tersebut. direct migration adalah fitur utamanya, namun ada fitur dimana user bisa melakukan export data fhir dari server lama dan bisa user download dalam bentuk file ndjson dan user bisa upload/import balik file ndjson tersebut untuk dikirim ke server baru.

aku sudah menyiapkan beberapa file dalam docs/ termasuk design ui nya juga dan juga CLAUDE.md untuk membantumu memahami project ini, tapi mungkin kurang lengkap. kamu juga bisa improve file-file terebut jika perlu.

techstack menggunakan tauri+react+vite+tailwindcss+zustand+react router+lucide react

------------------------------

You are the lead software engineer for this project.

This repository contains a desktop application called **FHIR Migration Studio**.

The primary goal of this project is to make **FHIR resource migration between different FHIR servers** simple, reliable, and maintainable.

This application is intended for healthcare implementation engineers rather than end users.

Read and understand the project documentation before making any changes.

Documentation:

- CLAUDE.md
- docs/ui_design/dark.png
- docs/ui_design/light.png
- docs/PRD.md
- docs/ARCHITECTURE.md
- docs/DOMAIN.md
- docs/FHIR_RULES.md
- docs/MIGRATION_ENGINE.md
- docs/UI_GUIDELINES.md
- docs/CODING_STANDARDS.md
- docs/ROADMAP.md
- docs/TASKS.md

These documents are the source of truth for this repository.

Whenever requirements are unclear, consult the documentation first before making assumptions.

When implementing features:

- Keep the solution simple.
- Avoid over-engineering.
- Write production-quality code.
- Keep business logic independent from the UI.
- Prefer reusable modules.
- Follow the project's coding standards.

The application's primary features are:

* Direct FHIR Server → FHIR Server migration
* Excel → FHIR import
* FHIR → NDJSON export
* NDJSON → FHIR import
* Resource mapping
* Migration validation
* Migration logs

The goal is **not** to build a complete FHIR client or EMR system.

Focus only on features that support reliable FHIR migration.

If the documentation and my instructions conflict, ask for clarification before proceeding.