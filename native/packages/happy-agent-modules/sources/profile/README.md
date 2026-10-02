# Profile

The one person this installation belongs to. The module owns exactly one stable profile identity
and its one optional photo. It takes no config, path, host, or storage object.

Call `open(instanceId)` after installation startup. `ensure(ctx)` then materializes the stable
empty singleton when needed; that initialization is not a user change and emits no event.
`create(ctx, { name, email })` remains the one-step operation used by P2P identity setup and
refuses a second profile.

## Public operations

- `get(ctx)` reads an already-materialized profile.
- `ensure(ctx)` returns the singleton, creating it with `name`, `email`, and `photo` set to `null`.
- `getById(ctx, profileId)` and `isLocal(ctx, profileId)` expose the private identity seam used by
  sharing.
- `update(ctx, profileId, patch, { expectedVersion? })` changes or clears `name` and `email`.
- `getPhoto(ctx)` returns normalized WebP bytes, content hash, strong ETag, dimensions, and
  ThumbHash, or `undefined`.
- `putPhoto(ctx, bytes, contentType, { expectedVersion? })` accepts PNG, JPEG, or WebP up to
  8 MiB, strips metadata, bounds dimensions, and atomically replaces the retained image.
- `deletePhoto(ctx, { expectedVersion? })` removes it. Deleting an absent photo is idempotent.

Conditional mutation failure throws `ProfileVersionConflictError`, whose `current` field is the
authoritative profile. API callers use this as their atomic `If-Match` boundary.

## Versions and events

Every actual mutation mints a UUIDv7 strictly newer than the profile version it replaces, including
through clock rollback and restart. `profile_changed` is delivered after commit and carries
`profileId`, `previousVersion`, and `version`; its event ID is the new version. Listener failure is
logged and cannot roll back or conceal the durable mutation.

## Storage

Released migration `001-profile` remains unchanged. Append-only migration `002-profile-photo`
adds the single-row bounded image table. The profile JSON owns metadata and the photo table owns
the bytes; both change in one transaction. Replacement retains one blob, deletion retains none,
and photo reads verify the SHA-256 content hash before returning bytes.
