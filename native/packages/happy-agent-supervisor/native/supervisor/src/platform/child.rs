//! Running the workload as a child and then becoming indistinguishable from it.
//!
//! Both platforms need this once something has to outlive `execve`: Linux keeps a namespace init
//! alive, and macOS keeps the outgoing proxy alive. The caller's shell must still see the
//! workload's own exit code or terminating signal, not the supervisor's.

use crate::{SupervisorResult, invalid_input};
use std::sync::atomic::{AtomicI32, Ordering};

pub(crate) const STATUS_EXIT: u8 = 0;
pub(crate) const STATUS_SIGNAL: u8 = 1;

const FORWARDED_SIGNALS: &[libc::c_int] =
    &[libc::SIGHUP, libc::SIGINT, libc::SIGQUIT, libc::SIGTERM];

static FORWARD_PID: AtomicI32 = AtomicI32::new(0);

#[derive(Clone, Copy)]
pub(crate) struct WorkloadStatus {
    pub(crate) kind: u8,
    pub(crate) value: i32,
}

pub(crate) fn set_forward_target(pid: libc::pid_t) {
    FORWARD_PID.store(pid, Ordering::SeqCst);
}

pub(crate) fn install_signal_forwarders() -> SupervisorResult<()> {
    for signal in FORWARDED_SIGNALS {
        let mut action = unsafe { std::mem::zeroed::<libc::sigaction>() };
        action.sa_sigaction = forward_signal as *const () as libc::sighandler_t;
        unsafe { libc::sigemptyset(&mut action.sa_mask) };
        if unsafe { libc::sigaction(*signal, &action, std::ptr::null_mut()) } != 0 {
            return Err(std::io::Error::last_os_error().into());
        }
    }
    Ok(())
}

extern "C" fn forward_signal(signal: libc::c_int) {
    let pid = FORWARD_PID.load(Ordering::SeqCst);
    if pid > 0 {
        unsafe {
            libc::kill(-pid, signal);
            libc::kill(pid, signal);
        }
    }
}

pub(crate) fn reset_signal_handlers() {
    for signal in FORWARDED_SIGNALS {
        unsafe {
            libc::signal(*signal, libc::SIG_DFL);
        }
    }
}

pub(crate) fn wait_for_pid(pid: libc::pid_t) -> SupervisorResult<libc::c_int> {
    loop {
        let mut status = 0;
        let result = unsafe { libc::waitpid(pid, &mut status, 0) };
        if result == pid {
            return Ok(status);
        }
        if result < 0 {
            let error = std::io::Error::last_os_error();
            if error.kind() == std::io::ErrorKind::Interrupted {
                continue;
            }
            return Err(error.into());
        }
    }
}

pub(crate) fn wait_status_to_workload_status(status: libc::c_int) -> Option<WorkloadStatus> {
    if libc::WIFEXITED(status) {
        Some(WorkloadStatus {
            kind: STATUS_EXIT,
            value: libc::WEXITSTATUS(status),
        })
    } else if libc::WIFSIGNALED(status) {
        Some(WorkloadStatus {
            kind: STATUS_SIGNAL,
            value: libc::WTERMSIG(status),
        })
    } else {
        None
    }
}

pub(crate) fn reproduce_status(status: WorkloadStatus) -> SupervisorResult<()> {
    if status.kind == STATUS_EXIT {
        std::process::exit(status.value);
    }
    if status.kind != STATUS_SIGNAL {
        return Err(invalid_input("namespace init returned an invalid workload status").into());
    }
    unsafe {
        libc::signal(status.value, libc::SIG_DFL);
        let mut unblocked = std::mem::zeroed::<libc::sigset_t>();
        libc::sigemptyset(&mut unblocked);
        libc::sigaddset(&mut unblocked, status.value);
        libc::sigprocmask(libc::SIG_UNBLOCK, &unblocked, std::ptr::null_mut());
        libc::raise(status.value);
    }
    std::process::exit(128 + status.value);
}
