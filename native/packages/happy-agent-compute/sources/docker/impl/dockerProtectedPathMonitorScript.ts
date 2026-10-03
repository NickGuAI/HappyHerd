/**
 * A wrapper that watches for a restricted command creating a path it must not.
 *
 * The native supervisor can make an existing protected path read-only, but it cannot forbid the creation of a
 * path that does not exist yet — a restricted command that creates protected metadata for itself
 * would otherwise grant itself policy the next command trusts. This POSIX-shell wrapper watches the
 * named paths while the real command runs, deletes anything that appears, and fails an otherwise
 * successful command that tried, so the boundary holds even against a first-time creation.
 */
export const DOCKER_PROTECTED_PATH_MONITOR_SCRIPT = String.raw`
pid_file=$1
shift
printf '%s\n' "$$" > "$pid_file"

monitor_one() {
    marker=$1
    path=$2
    reported=0
    while :; do
        if [ -e "$path" ] || [ -L "$path" ]; then
            if [ "$reported" -eq 0 ]; then
                printf 'protected-path-violation\n' >> "$marker"
                reported=1
            fi
            if [ -d "$path" ] && [ ! -L "$path" ]; then
                rm -rf -- "$path"
            else
                rm -f -- "$path"
            fi
        fi
        grep -q '^protected-path-stop$' "$marker" && break
        sleep 0.01
    done
}

monitor_paths() {
    marker=$1
    shift
    for path in "$@"; do
        [ "$path" = "--" ] && break
        if [ ! -e "$path" ] && [ ! -L "$path" ]; then
            monitor_one "$marker" "$path" &
        fi
    done
    printf 'protected-path-ready\n' >> "$marker"
    wait
}

monitor_paths "$pid_file" "$@" &
monitor_pid=$!
while ! grep -q '^protected-path-ready$' "$pid_file"; do sleep 0.01; done
while [ "$1" != "--" ]; do shift; done
shift
"$@"
status=$?
printf 'protected-path-stop\n' >> "$pid_file"
wait "$monitor_pid"
if grep -q '^protected-path-violation$' "$pid_file" && [ "$status" -eq 0 ]; then
    printf 'Sandbox blocked creation of protected agent metadata.\n' >&2
    status=1
fi
exit "$status"
`;
