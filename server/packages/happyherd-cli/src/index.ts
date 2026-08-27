/** Public package entry point and executable adapter. */

import { runCli } from './cli';

export { runCli } from './cli';

export async function main(args: string[]): Promise<number> {
  return runCli(args);
}
