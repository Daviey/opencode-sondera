# ADR-004: Single-File Bundled Plugin

Date: 2025-03

## Context

opencode auto-loads all `.ts` files from `~/.config/opencode/plugins/`. The plugin source is split across multiple files (`index.ts`, `client.ts`, `normalize.ts`, `types.ts`, `toast.ts`, `config.ts`, `audit.ts`, `metrics.ts`).

If all files are placed directly in `plugins/`, opencode tries to load each one as a plugin. Only `index.ts` exports a plugin; the others are modules. This causes errors or duplicate loads.

## Decision

Create a single self-contained `.ts` file with everything inlined. `scripts/sync-bundle.ts` concatenates all `src/` files into `sondera-bundled.ts`, separated by header comments.

## Alternatives considered

Subdirectory `plugins/sondera/`: unclear whether opencode recursively loads from subdirs.

npm package imports: possible but adds a distribution step beyond copying a single file.

## Consequences

Changes to `src/` must be synced to the bundled file via `bun run sync-bundle`. The multi-file `src/` version exists for development and testing. The bundled file is not tracked in git (ADR-017) and is generated fresh in CI and via `prepublishOnly`.
