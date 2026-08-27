/** Thin HappyHerd alias for the bundled upstream Happy CLI. */

import { runHappy } from './runtime';

/** Forward one invocation to Happy without interpreting its arguments. */
export async function runCli(args: string[]): Promise<number> {
  return runHappy(args);
}
