# Outgoing proxy

The supervisor owns both ends of this.

`egress.rs` forks the one process that stays outside the jail — outside the
network namespace on Linux, outside the Seatbelt profile on macOS — and joins it
to the front-ends with a `socketpair`. It owns `hosts.rs`, which decides whether
a destination is allowed: the name must match `network.allowedHosts` exactly or
under one `*.suffix`, and the address it actually resolved to must not be
loopback, private, link-local, or multicast unless the policy named that literal.

`protocol.rs` is the frame format both ends share and `mux.rs` is the front-end
half of it, with per-stream credit so a stalled workload connection cannot stall
the rest. `http.rs` and `socks.rs` translate `CONNECT`, absolute-URI, and SOCKS5
into `open_stream(host, port)`; `bridge.rs` joins an accepted loopback socket to
its stream. `credential.rs` is the per-invocation secret both front-ends demand,
delivered to the workload only inside the proxy URLs.

No TLS is unwrapped here and no certificate is minted here. The boundary is which
host may be reached, not what is sent to it.
