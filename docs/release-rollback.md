# Immutable release and rollback

HappyHerd releases are deployed only by registry digest. A dated release
manifest records both the current and the immediately previous healthy image,
their exact source commits, and smoke evidence for each image. Mutable tags are
informational and cannot be activated.

Validate a release manifest:

```bash
node scripts/verify-release-manifest.mjs docs/releases/RELEASE.json
```

Activate its current image:

```bash
sudo scripts/activate-release.sh \
  docs/releases/RELEASE.json \
  /etc/happyherd/runtime.env \
  current
```

Roll back to its recorded previous digest in one command:

```bash
sudo scripts/rollback-release.sh \
  docs/releases/RELEASE.json \
  /etc/happyherd/runtime.env
```

Activation pulls the selected digest, atomically updates only
`HAPPYHERD_IMAGE`, restarts `happyherd.service`, and accepts the result only
after the local `/health` endpoint identifies a healthy `happy-server`. If that
gate fails, the script atomically restores the prior digest, restarts it, and
verifies recovery before returning failure.

Run the contract test without touching the host service:

```bash
scripts/test-release-rollback.sh
```
