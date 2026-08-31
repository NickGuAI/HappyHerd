#!/usr/bin/env bash

remove_exact_legacy_happy_link() {
    local link_path="$1"
    local install_target="$2"

    if [[ -L "$link_path" ]] \
        && [[ "$(readlink "$link_path")" == "$install_target/bin/happy.mjs" ]]; then
        rm -f "$link_path"
    fi
}
