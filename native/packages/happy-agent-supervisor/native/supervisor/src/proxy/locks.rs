//! Lock helpers shared by both ends of the link.
//!
//! Poisoning cannot occur in a release build, which aborts on panic, and a poisoned lock in a debug
//! build still describes the state accurately enough to keep failing closed.

use std::sync::{Condvar, Mutex, MutexGuard};

pub(crate) fn guard<T>(lock: &Mutex<T>) -> MutexGuard<'_, T> {
    match lock.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    }
}

pub(crate) fn wait<'a, T>(signal: &Condvar, state: MutexGuard<'a, T>) -> MutexGuard<'a, T> {
    match signal.wait(state) {
        Ok(state) => state,
        Err(poisoned) => poisoned.into_inner(),
    }
}
