# ADR-017: Bundled File Not Tracked in Git

Date: 2026-05

## Context

`sondera-bundled.ts` is a generated file that concatenates all `src/` modules into a single installable plugin. Every change to any source file produces a noisy diff in the bundled file. Reviewing PRs required scrolling past hundreds of lines of mechanically generated code.

## Decision

Add `sondera-bundled.ts` to `.gitignore`. Generate it in two places:
- CI: `bun run sync-bundle` step in both `publish-npm` and `publish-github` jobs before `npm publish`
- Local: `prepublishOnly` script in `package.json` runs `bun run sync-bundle` before `npm publish`

The `files` array in `package.json` still includes `sondera-bundled.ts` so it ships in the npm tarball.

## Consequences

PRs show only source changes. The bundled file is regenerated fresh in CI and during local publish. Developers must run `bun run sync-bundle` manually when testing the installed plugin locally.

CI needs `bun` installed (via `oven-sh/setup-bun@v2`) because the sync script uses `Bun.file` and `Bun.write`.
