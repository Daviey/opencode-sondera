# ADR-014: Per-Project Config File

Date: 2025-03

## Context

Environment variables are global. Teams working across multiple projects may want different settings per project (different allow patterns, audit log paths, or strict mode).

## Decision

Read `.opencode/sondera.json` or `sondera.json` from the project root directory (passed as `directory` in the plugin context). The config file supports the same options as env vars: `enabled`, `dryRun`, `allowPatterns`, `auditLogPath`, `strictMode`.

Precedence: env vars override project config. This lets a CI pipeline force `SONDERA_STRICT=1` regardless of project config, while still reading the project's allow patterns.

## Consequences

The config is loaded once at plugin initialization. Changes to the file during a session are not picked up.
