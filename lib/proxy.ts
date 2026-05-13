interface ProxyConfig {
  server: string;
  username: string;
  password: string;
}

function buildBrightDataProxy(): ProxyConfig {
  const sessionId = Math.random().toString(36).substring(2, 10);
  return {
    server: process.env.BRIGHTDATA_SERVER!,
    username: `${process.env.BRIGHTDATA_USER}-session-${sessionId}`,
    password: process.env.BRIGHTDATA_PASS!,
  };
}

function buildOxylabsProxy(): ProxyConfig {
  const sessionId = Math.random().toString(36).substring(2, 12);
  return {
    server: process.env.OXYLABS_SERVER!,
    username: `customer-${process.env.OXYLABS_USER}-sessid-${sessionId}-country-US`,
    password: process.env.OXYLABS_PASS!,
  };
}

export function getProxy(): ProxyConfig | null {
  const provider = process.env.PROXY_PROVIDER;
  if (!provider) return null;

  if (provider === "brightdata") return buildBrightDataProxy();
  if (provider === "oxylabs") return buildOxylabsProxy();

  throw new Error(`Unknown PROXY_PROVIDER: ${provider}`);
}
