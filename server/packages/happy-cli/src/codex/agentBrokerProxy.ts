import { ProxyAgent } from 'undici';

export function buildHappyHerdAgentBrokerDispatcher(
  env: NodeJS.ProcessEnv = process.env,
): ProxyAgent | undefined {
  if (env.HAPPYHERD_AGENT_BROKER_PROXY_REQUIRED !== '1') return undefined;
  if (env.SANDBOX_RUNTIME !== '1') {
    throw new Error('HappyHerd Agent broker proxying is allowed only inside the HappyHerd sandbox');
  }
  const proxyUrl = env.HTTP_PROXY?.trim() || env.http_proxy?.trim();
  if (!proxyUrl) throw new Error('HappyHerd sandbox HTTP proxy is unavailable');
  const parsed = new URL(proxyUrl);
  if (
    parsed.protocol !== 'http:'
    || !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)
    || parsed.username
    || parsed.password
    || parsed.pathname !== '/'
    || parsed.search
    || parsed.hash
    || !parsed.port
  ) {
    throw new Error('HappyHerd sandbox HTTP proxy must be credential-free loopback HTTP');
  }
  return new ProxyAgent(parsed.toString());
}
