import { createRootContext, withLifetime } from "@steve.kite/stdlib";

export const testContext = createRootContext().named("happy-providers-test");

export const testContextWith = (signal: AbortSignal) => withLifetime(testContext, signal);
