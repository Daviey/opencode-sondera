# ADR-022: Bundle Export Stripping

## Status

Accepted

## Context

The opencode plugin loader discovers plugin entry points by iterating over module exports and calling them as functions. When the bundled file contained `export class PolicyDenyError` and similar class declarations, the loader tried to call the class constructor without `new`, producing `Cannot call a class constructor AdjudicationError without |new|`.

The bundled file is a concatenation of all `src/*.ts` files. Source files need their exports for tests and type checking, but the bundled output is consumed by opencode's loader which only needs the `SonderaPlugin` entry point.

## Decision

The `sync-bundle.ts` script strips all `export` keywords from the bundled output except for `SonderaPlugin`. This is done with a single regex after the existing import/export stripping passes.

## Consequences

- Source files keep normal `export` statements for tests and IDE support
- Bundled output only exposes `SonderaPlugin`, which is what the loader expects
- Error classes (PolicyDenyError, AdjudicationError, HarnessUnavailableError) are internal to the bundle and not accessible from outside
- Any new exports added to source files are automatically stripped in the bundle
