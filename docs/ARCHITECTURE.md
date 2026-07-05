# Architecture

Layers

UI (React + Tauri)
↓
Application
↓
Migration Engine
↓
FHIR Client

Engine modules:
- Scanner
- Downloader
- Mapper
- Bundle Builder
- Uploader
- Validator
- Reporter

UI never talks directly to HTTP.
