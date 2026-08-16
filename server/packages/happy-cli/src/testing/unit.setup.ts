import { SESSION_SCOPED_ENV_KEYS } from '@/daemon/sessionEnvironment';

// A unit worker may be launched from inside a live HappyHerd session. Never
// let that parent session's reconnect, Commander, automation, or provider IDs
// become fixtures implicitly; tests that need them must opt in explicitly.
for (const key of SESSION_SCOPED_ENV_KEYS) {
    delete process.env[key];
}
