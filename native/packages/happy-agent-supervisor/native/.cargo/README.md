# Cargo target configuration

Both Linux release targets request static CRT linkage. Linker selection remains
the build runner's responsibility so native arm64 and x64 runners use their
normal musl toolchains.
