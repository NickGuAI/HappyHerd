# Project file tests

These tests cover confined reads and compare-and-swap writes, Git revision reads, direct physical
tree pages, debounced change events, and the FFF index used by composer autocomplete. Tests close
every native finder and directory watcher before removing their temporary workspace so background
filesystem handles never outlive a scenario.
