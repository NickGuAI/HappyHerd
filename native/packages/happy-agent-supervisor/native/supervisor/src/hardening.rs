//! Defence in depth for the supervisor process itself.
//!
//! The boundary the supervisor establishes is Seatbelt or the Linux namespaces, and neither of them
//! is what this module is about. This is about the process on the trusted side of that boundary: it
//! runs under the same user as the workload, it holds the only route out of the jail, and it stays
//! alive for as long as the workload does. Anything that can read its memory or subvert its loader
//! before the boundary exists gets the route out for free.
//!
//! Two of the three steps here are already covered by the boundary itself — the workload cannot see
//! the egress process through a PID namespace, and the Seatbelt profile denies `process-info*` on
//! anything outside the sandbox. They are applied anyway, because they cost nothing and because
//! neither of those two protections is the reason the memory should be unreadable.

use crate::SupervisorResult;
use std::ffi::OsString;
use std::os::unix::ffi::OsStrExt;

/// Hardens the supervisor before it forks anything or establishes any boundary.
///
/// This snapshots the caller's environment first, so that stripping the loader variables below
/// changes what this process will load without changing what the workload is given. The workload's
/// own loader variables are its own business: it is free to set them for its children in any case,
/// so removing them there would cost a legitimate `LD_LIBRARY_PATH` and buy nothing.
pub(crate) fn apply() -> SupervisorResult<()> {
    crate::exec::capture_caller_environment();
    deny_debugger_attach()?;
    disable_core_dumps()?;
    remove_loader_variables();
    Ok(())
}

/// Makes this process unattachable by a debugger running as the same user.
///
/// This is called again in the egress process after the fork. On Linux the setting lives in the
/// memory descriptor and is inherited, but macOS gives the child a fresh set of process flags, and
/// the egress process is the one worth protecting: it is outside every boundary by design.
pub(crate) fn deny_debugger_attach() -> SupervisorResult<()> {
    #[cfg(target_os = "linux")]
    {
        // A non-dumpable process cannot be attached to, and its `/proc` entries become root-owned,
        // which is what keeps a same-user reader out of its memory.
        if unsafe { libc::prctl(libc::PR_SET_DUMPABLE, 0, 0, 0, 0) } != 0 {
            return Err(std::io::Error::other(format!(
                "mark the supervisor non-dumpable: {}",
                std::io::Error::last_os_error()
            ))
            .into());
        }
    }
    #[cfg(target_os = "macos")]
    {
        if unsafe { libc::ptrace(libc::PT_DENY_ATTACH, 0, std::ptr::null_mut(), 0) } == -1 {
            return Err(std::io::Error::other(format!(
                "deny debugger attachment to the supervisor: {}",
                std::io::Error::last_os_error()
            ))
            .into());
        }
    }
    Ok(())
}

/// Stops the supervisor's memory from reaching the filesystem if it crashes.
///
/// The limit is inherited by the workload, which is intended: a core file written from inside the
/// sandbox would land wherever the system sends core files, which is not somewhere the policy has
/// any say over.
fn disable_core_dumps() -> SupervisorResult<()> {
    let limit = libc::rlimit {
        rlim_cur: 0,
        rlim_max: 0,
    };
    if unsafe { libc::setrlimit(libc::RLIMIT_CORE, &limit) } != 0 {
        return Err(std::io::Error::other(format!(
            "disable core dumps for the supervisor: {}",
            std::io::Error::last_os_error()
        ))
        .into());
    }
    Ok(())
}

/// Drops the variables that let someone else choose what this process loads.
///
/// The Linux binary is statically linked against musl and ignores these already; the macOS one is
/// not, and `DYLD_INSERT_LIBRARIES` would otherwise run chosen code inside the process that is
/// about to become the boundary.
fn remove_loader_variables() {
    for key in loader_variables(std::env::vars_os()) {
        // Nothing else is running yet: this is the supervisor before it has forked or started a
        // thread, which is the only point at which editing the environment is defined behaviour.
        unsafe {
            std::env::remove_var(key);
        }
    }
}

const LOADER_PREFIXES: [&[u8]; 2] = [b"LD_", b"DYLD_"];

fn loader_variables<I>(variables: I) -> Vec<OsString>
where
    I: IntoIterator<Item = (OsString, OsString)>,
{
    variables
        .into_iter()
        .filter_map(|(key, _)| {
            LOADER_PREFIXES
                .iter()
                .any(|prefix| key.as_os_str().as_bytes().starts_with(prefix))
                .then_some(key)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::loader_variables;
    use std::ffi::OsStr;
    use std::ffi::OsString;
    use std::os::unix::ffi::OsStrExt;
    use std::os::unix::ffi::OsStringExt;

    #[test]
    fn only_the_loader_variables_are_dropped() {
        let variables = vec![
            (OsString::from("PATH"), OsString::from("/usr/bin")),
            (OsString::from("LD_PRELOAD"), OsString::from("/tmp/evil.so")),
            (
                OsString::from("DYLD_INSERT_LIBRARIES"),
                OsString::from("/tmp/evil.dylib"),
            ),
            (OsString::from("HOLD_ON"), OsString::from("1")),
        ];

        let dropped = loader_variables(variables);

        assert_eq!(
            dropped,
            vec![
                OsString::from("LD_PRELOAD"),
                OsString::from("DYLD_INSERT_LIBRARIES")
            ]
        );
    }

    #[test]
    fn a_variable_that_is_not_valid_text_is_still_dropped() {
        // An environment is bytes, not text, so a name that cannot be read as UTF-8 must not be a
        // way to smuggle a loader variable past this.
        let smuggled = OsString::from_vec(vec![b'L', b'D', b'_', 0xf0]);
        assert!(smuggled.clone().into_string().is_err());

        let dropped = loader_variables(vec![
            (smuggled.clone(), OsString::from("1")),
            (
                OsStr::from_bytes(b"R\xd6DBURK").to_os_string(),
                OsString::from("1"),
            ),
        ]);

        assert_eq!(dropped, vec![smuggled]);
    }
}
