import fs from "node:fs";
import path from "node:path";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

const DEV_VARS_PATH = path.resolve(__dirname, "../../apps/sdp-api/.dev.vars");

function loadEnvFile(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  const content = fs.readFileSync(filePath, "utf8");
  const vars: Record<string, string> = {};

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const [key, ...rest] = trimmed.split("=");
    if (!key) {
      continue;
    }
    const raw = rest.join("=");
    const quoted = raw.match(/^(['"])(.*)\1$/);
    vars[key] = quoted ? quoted[2] : raw;
  }

  return vars;
}

const fileEnv = loadEnvFile(DEV_VARS_PATH);
const getEnv = (key: string, fallback?: string) => process.env[key] ?? fileEnv[key] ?? fallback;

const custodyEncryptionKey =
  getEnv("CUSTODY_ENCRYPTION_KEY") ?? Buffer.alloc(32).toString("base64");
// biome-ignore lint/security/noSecrets: Local Docker Postgres fallback for isolated integration tests.
const databaseUrl = getEnv("DATABASE_URL", "postgresql://sdp:sdp@127.0.0.1:5432/sdp");
const koraRpcUrl = getEnv("KORA_RPC_URL");
const koraApiKey = getEnv("KORA_API_KEY");
const koraTimeoutMs = getEnv("KORA_TIMEOUT_MS");
const koraSurfpoolShim = getEnv("KORA_SURFPOOL_SHIM");
const integrationSuite = getEnv("SDP_INTEGRATION_SUITE");
const integrationCustodyProvider = getEnv("SDP_INTEGRATION_CUSTODY_PROVIDER");
const custodyPrivateKey = getEnv("CUSTODY_PRIVATE_KEY");
const privyAppId = getEnv("PRIVY_APP_ID");
const privyAppSecret = getEnv("PRIVY_APP_SECRET");
const privyApiBaseUrl = getEnv("PRIVY_API_BASE_URL");
const privyRequestDelayMs = getEnv("PRIVY_REQUEST_DELAY_MS");
const turnkeyApiPublicKey = getEnv("TURNKEY_API_PUBLIC_KEY");
const turnkeyApiPrivateKey = getEnv("TURNKEY_API_PRIVATE_KEY");
const turnkeyOrganizationId = getEnv("TURNKEY_ORGANIZATION_ID");
const turnkeyApiBaseUrl = getEnv("TURNKEY_API_BASE_URL");
const turnkeyRequestDelayMs = getEnv("TURNKEY_REQUEST_DELAY_MS");
// Private Channels (SPC) wallet-verification suite.
const privateChannelsEnabled = getEnv("PRIVATE_CHANNELS_ENABLED");
const privateChannelPocAuthSecret = getEnv("PRIVATE_CHANNEL_POC_AUTH_SECRET");
const spcAuthUrl = getEnv("SPC_AUTH_URL");
const spcGatewayUrl = getEnv("SPC_GATEWAY_URL");
const spcEscrowProgramId = getEnv("SPC_ESCROW_PROGRAM_ID");
const spcWithdrawProgramId = getEnv("SPC_WITHDRAW_PROGRAM_ID");
const spcEscrowInstanceAddr = getEnv("SPC_ESCROW_INSTANCE_ADDR");

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: {
        configPath: path.resolve(__dirname, "../../apps/sdp-api/wrangler.toml"),
      },
      miniflare: {
        bindings: {
          ENVIRONMENT: "development",
          API_VERSION: "v1",
          HYPERDRIVE: { connectionString: databaseUrl },
          RUN_INTEGRATION_TESTS: "true",
          SOLANA_MOCK: "false",
          API_KEY_PEPPER: getEnv("API_KEY_PEPPER", "test-pepper-for-integration"),
          // Fallback keeps the Workers pool binding defined for SPC-only runs; real
          // integration runs always override it via run-workspace-tests.mjs.
          SOLANA_RPC_URL: getEnv("SOLANA_RPC_URL", "https://api.devnet.solana.com"),
          SOLANA_NETWORK: getEnv("SOLANA_NETWORK", "devnet"),
          CUSTODY_ENCRYPTION_KEY: custodyEncryptionKey,
          // Kora configuration - only set if explicitly configured
          // Local: KORA_RPC_URL=http://localhost:8080 pnpm test
          // CI: Set KORA_RPC_URL in workflow env
          ...(koraRpcUrl && {
            KORA_RPC_URL: koraRpcUrl,
            FEE_PAYMENT_PROVIDER: "kora",
            ...(koraApiKey && { KORA_API_KEY: koraApiKey }),
            ...(koraTimeoutMs && { KORA_TIMEOUT_MS: koraTimeoutMs }),
          }),
          ...(koraSurfpoolShim && { KORA_SURFPOOL_SHIM: koraSurfpoolShim }),
          ...(integrationSuite && { SDP_INTEGRATION_SUITE: integrationSuite }),
          ...(integrationCustodyProvider && {
            SDP_INTEGRATION_CUSTODY_PROVIDER: integrationCustodyProvider,
          }),
          ...(custodyPrivateKey && { CUSTODY_PRIVATE_KEY: custodyPrivateKey }),
          ...(privyAppId && { PRIVY_APP_ID: privyAppId }),
          ...(privyAppSecret && { PRIVY_APP_SECRET: privyAppSecret }),
          ...(privyApiBaseUrl && { PRIVY_API_BASE_URL: privyApiBaseUrl }),
          ...(privyRequestDelayMs && {
            PRIVY_REQUEST_DELAY_MS: privyRequestDelayMs,
          }),
          ...(turnkeyApiPublicKey && {
            TURNKEY_API_PUBLIC_KEY: turnkeyApiPublicKey,
          }),
          ...(turnkeyApiPrivateKey && {
            TURNKEY_API_PRIVATE_KEY: turnkeyApiPrivateKey,
          }),
          ...(turnkeyOrganizationId && {
            TURNKEY_ORGANIZATION_ID: turnkeyOrganizationId,
          }),
          ...(turnkeyApiBaseUrl && { TURNKEY_API_BASE_URL: turnkeyApiBaseUrl }),
          ...(turnkeyRequestDelayMs && {
            TURNKEY_REQUEST_DELAY_MS: turnkeyRequestDelayMs,
          }),
          // Private Channels (SPC) wallet-verification suite.
          ...(privateChannelsEnabled && { PRIVATE_CHANNELS_ENABLED: privateChannelsEnabled }),
          ...(privateChannelPocAuthSecret && {
            PRIVATE_CHANNEL_POC_AUTH_SECRET: privateChannelPocAuthSecret,
          }),
          ...(spcAuthUrl && { SPC_AUTH_URL: spcAuthUrl }),
          ...(spcGatewayUrl && { SPC_GATEWAY_URL: spcGatewayUrl }),
          ...(spcEscrowProgramId && { SPC_ESCROW_PROGRAM_ID: spcEscrowProgramId }),
          ...(spcWithdrawProgramId && { SPC_WITHDRAW_PROGRAM_ID: spcWithdrawProgramId }),
          ...(spcEscrowInstanceAddr && { SPC_ESCROW_INSTANCE_ADDR: spcEscrowInstanceAddr }),
        },
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "../../apps/sdp-api/src"),
      "@sdp/api": path.resolve(__dirname, "../../apps/sdp-api/src"),
      "@sdp/api-test": path.resolve(__dirname, "../../apps/sdp-api/src/test"),
    },
  },
  test: {
    globals: true,
    setupFiles: ["src/setup.ts"],
    fileParallelism: false,
    include: ["src/**/*.test.ts"],
    exclude: ["node_modules", "dist"],
    testTimeout: 120000,
    hookTimeout: 120000,
    maxWorkers: 1,
    isolate: false,
  },
});
