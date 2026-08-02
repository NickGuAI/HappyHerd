# Runtime isolation

HappyHerd owns a separate runtime identity. It does not reuse the retired Happy
test service, `qmherd`, or any Herd state.

| Boundary | HappyHerd value |
|---|---|
| Domain | `happyherd.gehirn.ai` |
| Host port | `20015` |
| Data | `/var/lib/happyherd/data` |
| Logs | `/var/log/happyherd/server.log` |
| CLI home | `/var/lib/happyherd/cli` (`HAPPY_HOME_DIR`) |
| Master secret | `/etc/happyherd/master-secret`, mode `0600` |
| Container | `happyherd` |

The public runtime configuration lives at `/etc/happyherd/runtime.env`; the
secret value is stored in the separate file above and is never committed to Git
or echoed by the scripts. The image value must be an A6 immutable digest.

## Provision and run

```bash
sudo install -d -m 0750 /etc/happyherd
sudo install -m 0600 deploy/runtime.env.example /etc/happyherd/runtime.env
# Replace only HAPPYHERD_IMAGE with the released digest.
sudo scripts/prepare-runtime.sh /etc/happyherd/runtime.env
sudo install -m 0644 deploy/happyherd.service /etc/systemd/system/happyherd.service
sudo systemctl daemon-reload
sudo systemctl enable --now happyherd.service
```

The unit runs the immutable container in the foreground, persists application
state only under the HappyHerd data root, and writes stdout/stderr only to the
HappyHerd log. The Web configuration is injected with the HappyHerd public URL
and analytics disabled.

## Guardrail

```bash
scripts/test-runtime-isolation.sh
scripts/validate-runtime-isolation.sh /etc/happyherd/runtime.env runtime
```

Validation fails for overlapping runtime roots, legacy `.happy` or
`.happy-server-data`, Herd state, any `qmherd` path, an unpinned image, a
missing/weakly-permissioned secret, or a domain/port other than the reserved
HappyHerd identity.
