const PROBE_TIMEOUT_MS = 5000;

export interface GatewayProbeResponse {
  status: number;
  ok: boolean;
  body: unknown;
}

export type GatewayHealthResult =
  | {
      status: "ready";
      latencyMs: number;
      health: GatewayProbeResponse;
      ready: GatewayProbeResponse;
    }
  | {
      status: "degraded";
      latencyMs: number;
      health: GatewayProbeResponse;
      ready: GatewayProbeResponse;
      reason: string;
    }
  | {
      status: "unreachable";
      latencyMs: number;
      error: string;
      health?: GatewayProbeResponse;
      ready?: GatewayProbeResponse;
    };

function normalizeBase(input: string): { base: string } | { error: string } {
  const trimmed = input.trim();
  if (!trimmed) {
    return { error: "Gateway URL is required." };
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { error: `Invalid URL: ${trimmed}` };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { error: `Unsupported protocol: ${parsed.protocol}` };
  }
  const base = `${parsed.protocol}//${parsed.host}${parsed.pathname.replace(/\/$/, "")}`;
  return { base };
}

async function probe(url: string): Promise<GatewayProbeResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    const text = await res.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      // Non-JSON — keep as text.
    }
    return { status: res.status, ok: res.ok, body };
  } finally {
    clearTimeout(timeout);
  }
}

function extractDegradedReason(body: unknown): string {
  if (body && typeof body === "object") {
    const asRecord = body as Record<string, unknown>;
    const reason = asRecord.reason;
    if (typeof reason === "string" && reason) return reason;
    const status = asRecord.status;
    if (typeof status === "string" && status) return status;
  }
  return "Gateway reported degraded state.";
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === "AbortError") {
      return `Timed out after ${PROBE_TIMEOUT_MS} ms.`;
    }
    return error.message || "Request failed.";
  }
  return "Request failed.";
}

/**
 * Probe the SPC gateway's `/health` and `/ready` endpoints. Pure: no side effects
 * beyond the two HTTP requests. Safe to call from both server and Worker contexts.
 */
export async function probeGatewayHealth(gatewayUrl: string): Promise<GatewayHealthResult> {
  const startedAt = Date.now();
  const normalized = normalizeBase(gatewayUrl);
  if ("error" in normalized) {
    return { status: "unreachable", latencyMs: 0, error: normalized.error };
  }

  const { base } = normalized;
  const [healthResult, readyResult] = await Promise.allSettled([
    probe(`${base}/health`),
    probe(`${base}/ready`),
  ]);
  const latencyMs = Date.now() - startedAt;

  if (healthResult.status === "rejected") {
    return {
      status: "unreachable",
      latencyMs,
      error: toErrorMessage(healthResult.reason),
      ready: readyResult.status === "fulfilled" ? readyResult.value : undefined,
    };
  }

  const health = healthResult.value;

  if (!health.ok) {
    return {
      status: "unreachable",
      latencyMs,
      error: `GET ${base}/health returned ${health.status}.`,
      health,
      ready: readyResult.status === "fulfilled" ? readyResult.value : undefined,
    };
  }

  if (readyResult.status === "rejected") {
    return {
      status: "degraded",
      latencyMs,
      health,
      ready: {
        status: 0,
        ok: false,
        body: toErrorMessage(readyResult.reason),
      },
      reason: `GET ${base}/ready failed: ${toErrorMessage(readyResult.reason)}`,
    };
  }

  const ready = readyResult.value;
  if (!ready.ok) {
    return {
      status: "degraded",
      latencyMs,
      health,
      ready,
      reason: extractDegradedReason(ready.body),
    };
  }

  return { status: "ready", latencyMs, health, ready };
}
