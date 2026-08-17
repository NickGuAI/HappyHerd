/** Public package entry point and executable adapter. */

import { runCli, type CliDependencies } from './cli';

export { runCli } from './cli';
export { BrokerClient, loadBrokerClientConfig, loadBrokerServiceConfig } from './broker';
export { removeVerifiedManagedSkillsForUninstall } from './registry';
export type { BrokerClientInterface } from './broker';
export type { CliDependencies } from './cli';

export async function main(args: string[], dependencies?: CliDependencies): Promise<number> {
  return runCli(args, dependencies);
}
