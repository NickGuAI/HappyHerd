# Native source

`cli.rs` owns the injection-resistant invocation, `policy.rs` owns validation,
`exec.rs` resolves PATH only after the security boundary is active, `proxy/`
provides the whole outgoing proxy — loopback front-ends inside the jail and an
egress process outside it — and `platform/` applies Linux or macOS enforcement.
