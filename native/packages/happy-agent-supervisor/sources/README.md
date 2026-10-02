# TypeScript API

The public API exports the TypeBox policy schema and native-binary resolvers.

```text
SupervisorPolicy ──> JSON on a file or inherited descriptor
platform.ts      ──> current-host and Linux-container target selection
```

Mechanical package lookup lives in `impl/`; public behavior stays at this level.
