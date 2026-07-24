import * as privateChannelsPkg from "@sdp/private-channels";
import { SANDBOX_DEFAULTS } from "@sdp/private-channels";
import {
  type CachedApiKey,
  PRIVATE_CHANNEL_EVENT_FAMILIES,
  PRIVATE_CHANNEL_EVENT_STATUSES,
  PRIVATE_CHANNEL_EVENT_TYPES,
  PRIVATE_CHANNEL_MEMBERSHIP_ROLES,
  type PrivateChannelDto,
  type PrivateChannelEventListEnvelope,
} from "@sdp/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/db";
import app from "@/index";
import { hashString } from "@/lib/hash";
import * as pcServices from "@/services/private-channels";
import { env } from "@/test/helpers/env";
import { clearTestDatabase, seedTestDatabase } from "@/test/mocks/db";
import { clearKVNamespaces, seedCachedApiKey } from "@/test/mocks/kv";

const probeConnectionMock = vi.spyOn(privateChannelsPkg, "probeConnection");
const overviewMock = vi.spyOn(pcServices, "getInstanceOverview");

function unreachableOverview(error = "gateway down") {
  return {
    gateway: {
      health: { status: "unreachable" as const, latencyMs: 12, error },
      channelSlot: null,
      latestBlockhash: null,
    },
    chainRpc: { ok: false as const, error: "n/a" },
    escrowInstance: { present: false as const, error: "n/a" },
    escrowProgram: { present: false as const, error: "n/a" },
    auth: { reachable: false as const, error: "n/a" },
  };
}

const TEST_ORG = { id: "org_pce_test", name: "PC Events Test Org", slug: "pc-events-test-org" };
const TEST_PROJECT = { id: "prj_pce_test", slug: "pc-events-test-project" };
const TEST_USER = { id: "usr_pce_test", email: "pc-events-test@example.com" };
const TEST_API_KEY = { id: "key_pce_test", raw: "sk_test_pc_events", prefix: "sk_test_pce" };

const TEST_CACHED_API_KEY: CachedApiKey = {
  id: TEST_API_KEY.id,
  organizationId: TEST_ORG.id,
  projectId: TEST_PROJECT.id,
  role: "api_admin",
  permissions: ["*"],
  environment: "sandbox",
  rateLimitTier: "standard",
  allowedIps: null,
  signingWalletId: null,
  status: "active",
  expiresAt: null,
};

let originalEnabled: string | undefined;

function successProbe() {
  return {
    ok: true as const,
    gateway: {
      status: "ready" as const,
      latencyMs: 1,
      health: { status: 200, ok: true },
      ready: { status: 200, ok: true },
    },
    rpc: { ok: true as const, latencyMs: 1, version: "2.0.0" },
    auth: { ok: true as const, latencyMs: 1 },
  };
}

async function seedAuth(): Promise<void> {
  const keyHash = await hashString(TEST_API_KEY.raw, env.API_KEY_PEPPER);
  await seedCachedApiKey(env, keyHash, TEST_CACHED_API_KEY);
  await getDb(env).batch([
    getDb(env)
      .prepare("INSERT INTO organizations (id, name, slug, tier, status) VALUES (?, ?, ?, ?, ?)")
      .bind(TEST_ORG.id, TEST_ORG.name, TEST_ORG.slug, "enterprise", "active"),
    getDb(env)
      .prepare("INSERT INTO users (id, email, email_verified, status) VALUES (?, ?, ?, ?)")
      .bind(TEST_USER.id, TEST_USER.email, 1, "active"),
    getDb(env)
      .prepare(
        `INSERT INTO projects (id, organization_id, name, slug, environment, status, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        TEST_PROJECT.id,
        TEST_ORG.id,
        "Test Project",
        TEST_PROJECT.slug,
        "sandbox",
        "active",
        TEST_USER.id
      ),
    getDb(env)
      .prepare(
        `INSERT INTO api_keys
           (id, organization_id, project_id, created_by, name, key_prefix, key_hash, role, permissions, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        TEST_API_KEY.id,
        TEST_ORG.id,
        TEST_PROJECT.id,
        TEST_USER.id,
        "PC Events Test Key",
        TEST_API_KEY.prefix,
        keyHash,
        "api_admin",
        JSON.stringify(["*"]),
        "active"
      ),
  ]);
}

function authHeaders() {
  return { Authorization: `Bearer ${TEST_API_KEY.raw}`, "Content-Type": "application/json" };
}

async function nonAdminAuthHeaders() {
  const raw = "sk_test_pc_events_non_admin";
  const keyHash = await hashString(raw, env.API_KEY_PEPPER);
  await seedCachedApiKey(env, keyHash, {
    ...TEST_CACHED_API_KEY,
    id: "key_pce_non_admin",
    role: "api_developer",
    permissions: ["payments:read"],
  });
  return { Authorization: `Bearer ${raw}`, "Content-Type": "application/json" };
}

async function memberSession(channelId: string, role: "admin" | "member" = "member") {
  const sessionId = "ses_pce_member";
  const privateChannelUserId = "pcu_pce_member";
  const db = getDb(env);
  await db.batch([
    db
      .prepare(
        `INSERT INTO organization_members (id, organization_id, user_id, role, status)
         VALUES ('om_pce_member', ?, ?, 'member', 'active')`
      )
      .bind(TEST_ORG.id, TEST_USER.id),
    db
      .prepare(
        `INSERT INTO project_members (id, project_id, user_id, role)
         VALUES ('pm_pce_member', ?, ?, 'developer')`
      )
      .bind(TEST_PROJECT.id, TEST_USER.id),
    db
      .prepare(
        `INSERT INTO sessions (id, user_id, organization_id, auth_method, expires_at)
         VALUES (?, ?, ?, 'magic_link', ?)`
      )
      .bind(sessionId, TEST_USER.id, TEST_ORG.id, "2099-01-01T00:00:00.000Z"),
    db
      .prepare(
        `INSERT INTO private_channel_users (id, organization_id, project_id, user_id)
         VALUES (?, ?, ?, ?)`
      )
      .bind(privateChannelUserId, TEST_ORG.id, TEST_PROJECT.id, TEST_USER.id),
    db
      .prepare(
        `INSERT INTO private_channel_memberships
           (id, channel_id, private_channel_user_id, role)
         VALUES ('pcm_pce_member', ?, ?, ?)`
      )
      .bind(channelId, privateChannelUserId, role),
  ]);
  return {
    privateChannelUserId,
    headers: {
      Cookie: `sdp_session=${sessionId}`,
      "x-project-id": TEST_PROJECT.id,
      "Content-Type": "application/json",
    },
  };
}

async function connectInstance(): Promise<void> {
  probeConnectionMock.mockResolvedValueOnce(successProbe());
  const res = await app.request(
    "/v1/private-channels/instance",
    {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        gatewayUrl: SANDBOX_DEFAULTS.gatewayUrl,
        chainRpcUrl: SANDBOX_DEFAULTS.chainRpcUrl,
        escrowProgramId: SANDBOX_DEFAULTS.escrowProgramId,
        withdrawProgramId: SANDBOX_DEFAULTS.withdrawProgramId,
        escrowInstanceAddr: SANDBOX_DEFAULTS.escrowInstanceAddr,
        authUrl: SANDBOX_DEFAULTS.authUrl,
      }),
    },
    env
  );
  expect(res.status).toBe(200);
}

async function defaultChannelId(): Promise<string> {
  const list = await app.request("/v1/private-channels/channels", { headers: authHeaders() }, env);
  const body = (await list.json()) as { data: { channels: PrivateChannelDto[] } };
  const def = body.data.channels.find((c) => c.isDefault);
  expect(def).toBeDefined();
  return def?.id ?? "";
}

describe("Private Channels — event routes", () => {
  beforeEach(async () => {
    originalEnabled = env.PRIVATE_CHANNELS_ENABLED;
    env.PRIVATE_CHANNELS_ENABLED = "true";
    probeConnectionMock.mockReset();
    overviewMock.mockReset();
    await seedTestDatabase(env);
    await getDb(env).prepare("DELETE FROM private_channel_events").run();
    await seedAuth();
  });

  afterEach(async () => {
    env.PRIVATE_CHANNELS_ENABLED = originalEnabled;
    await clearTestDatabase(env);
    await clearKVNamespaces(env);
  });

  it("connect emits lifecycle.instance.connected visible on the default channel feed", async () => {
    await connectInstance();
    const channelId = await defaultChannelId();

    const res = await app.request(
      `/v1/private-channels/channels/${channelId}/events`,
      { headers: authHeaders() },
      env
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: PrivateChannelEventListEnvelope };
    expect(
      body.data.events.some(
        (e) => e.type === PRIVATE_CHANNEL_EVENT_TYPES.LIFECYCLE_INSTANCE_CONNECTED
      )
    ).toBe(true);
  });

  it("create channel emits lifecycle.channel.created", async () => {
    await connectInstance();
    const create = await app.request(
      "/v1/private-channels/channels",
      { method: "POST", headers: authHeaders(), body: JSON.stringify({ name: "Treasury" }) },
      env
    );
    const created = (await create.json()) as { data: PrivateChannelDto };

    const res = await app.request(
      `/v1/private-channels/channels/${created.data.id}/events?family=${PRIVATE_CHANNEL_EVENT_FAMILIES.LIFECYCLE}&type=${PRIVATE_CHANNEL_EVENT_TYPES.LIFECYCLE_CHANNEL_CREATED}`,
      { headers: authHeaders() },
      env
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: PrivateChannelEventListEnvelope };
    expect(body.data.events).toHaveLength(1);
    expect(body.data.events[0]?.type).toBe(PRIVATE_CHANNEL_EVENT_TYPES.LIFECYCLE_CHANNEL_CREATED);
    expect(body.data.events[0]?.channelId).toBe(created.data.id);
    expect(body.data.events[0]?.payload).toEqual({ name: "Treasury" });
  });

  it("paginates with before cursor", async () => {
    await connectInstance();
    const create = await app.request(
      "/v1/private-channels/channels",
      { method: "POST", headers: authHeaders(), body: JSON.stringify({ name: "Ops" }) },
      env
    );
    const created = (await create.json()) as { data: PrivateChannelDto };
    const channelId = created.data.id;

    // Seed extra events with known timestamps for deterministic pagination.
    const db = getDb(env);
    const instance = await db
      .prepare(
        "SELECT id, organization_id, project_id FROM private_channel_instances WHERE is_active = true LIMIT 1"
      )
      .first<{ id: string; organization_id: string; project_id: string }>();
    expect(instance).toBeTruthy();

    const archived = PRIVATE_CHANNEL_EVENT_TYPES.LIFECYCLE_CHANNEL_ARCHIVED;
    const lifecycle = PRIVATE_CHANNEL_EVENT_FAMILIES.LIFECYCLE;
    const info = PRIVATE_CHANNEL_EVENT_STATUSES.INFO;
    await db
      .prepare(
        `INSERT INTO private_channel_events
           (id, organization_id, project_id, instance_id, channel_id, family, type, status, payload, occurred_at)
         VALUES ('pce_old', ?, ?, ?, ?, ?, ?, ?, '{}'::jsonb, '2026-01-01T00:00:00.000Z')`
      )
      .bind(
        instance?.organization_id,
        instance?.project_id,
        instance?.id,
        channelId,
        lifecycle,
        archived,
        info
      )
      .run();
    await db
      .prepare(
        `INSERT INTO private_channel_events
           (id, organization_id, project_id, instance_id, channel_id, family, type, status, payload, occurred_at)
         VALUES ('pce_new', ?, ?, ?, ?, ?, ?, ?, '{}'::jsonb, '2026-06-01T00:00:00.000Z')`
      )
      .bind(
        instance?.organization_id,
        instance?.project_id,
        instance?.id,
        channelId,
        lifecycle,
        archived,
        info
      )
      .run();

    const page1 = await app.request(
      `/v1/private-channels/channels/${channelId}/events?type=${archived}&limit=1`,
      { headers: authHeaders() },
      env
    );
    const body1 = (await page1.json()) as { data: PrivateChannelEventListEnvelope };
    expect(body1.data.events[0]?.id).toBe("pce_new");
    expect(body1.data.hasMore).toBe(true);
    expect(body1.data.nextCursor).toBeTruthy();

    const page2 = await app.request(
      `/v1/private-channels/channels/${channelId}/events?type=${archived}&limit=1&before=${encodeURIComponent(body1.data.nextCursor ?? "")}`,
      { headers: authHeaders() },
      env
    );
    const body2 = (await page2.json()) as { data: PrivateChannelEventListEnvelope };
    expect(body2.data.events[0]?.id).toBe("pce_old");
    expect(body2.data.hasMore).toBe(false);
    expect(body2.data.nextCursor).toBeNull();
  });

  it("returns 404 for an unknown channel", async () => {
    await connectInstance();
    const res = await app.request(
      "/v1/private-channels/channels/pch_missing/events",
      { headers: authHeaders() },
      env
    );
    expect(res.status).toBe(404);
  });

  it("returns 503 when no active instance", async () => {
    const res = await app.request(
      "/v1/private-channels/channels/pch_anything/events",
      { headers: authHeaders() },
      env
    );
    expect(res.status).toBe(503);
  });

  it("overview emits error.spc_unreachable when the gateway is unreachable", async () => {
    await connectInstance();
    const channelId = await defaultChannelId();
    overviewMock.mockResolvedValue(unreachableOverview("boom"));

    const ov = await app.request(
      "/v1/private-channels/instance/overview",
      { headers: authHeaders() },
      env
    );
    expect(ov.status).toBe(200);

    const res = await app.request(
      `/v1/private-channels/channels/${channelId}/events?family=${PRIVATE_CHANNEL_EVENT_FAMILIES.ERROR}`,
      { headers: authHeaders() },
      env
    );
    const body = (await res.json()) as { data: PrivateChannelEventListEnvelope };
    const err = body.data.events.find(
      (e) => e.type === PRIVATE_CHANNEL_EVENT_TYPES.ERROR_SPC_UNREACHABLE
    );
    expect(err).toBeDefined();
    expect(err?.family).toBe(PRIVATE_CHANNEL_EVENT_FAMILIES.ERROR);
    expect(err?.status).toBe(PRIVATE_CHANNEL_EVENT_STATUSES.FAILED);
    expect(err?.channelId).toBeNull();
    expect(err?.payload).toMatchObject({
      message: "boom",
      gatewayUrl: SANDBOX_DEFAULTS.gatewayUrl,
    });
  });

  it("lists project-scoped events across channels", async () => {
    await connectInstance();
    const create = await app.request(
      "/v1/private-channels/channels",
      { method: "POST", headers: authHeaders(), body: JSON.stringify({ name: "Treasury" }) },
      env
    );
    expect(create.status).toBe(201);

    const res = await app.request("/v1/private-channels/events", { headers: authHeaders() }, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: PrivateChannelEventListEnvelope };
    const types = body.data.events.map((e) => e.type);
    expect(types).toContain(PRIVATE_CHANNEL_EVENT_TYPES.LIFECYCLE_INSTANCE_CONNECTED);
    expect(types).toContain(PRIVATE_CHANNEL_EVENT_TYPES.LIFECYCLE_CHANNEL_CREATED);
  });

  it("project feed survives instance deletion (durable history)", async () => {
    await connectInstance();
    const del = await app.request(
      "/v1/private-channels/instance",
      { method: "DELETE", headers: authHeaders() },
      env
    );
    expect(del.status).toBe(200);

    const res = await app.request("/v1/private-channels/events", { headers: authHeaders() }, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: PrivateChannelEventListEnvelope };
    expect(
      body.data.events.some(
        (e) => e.type === PRIVATE_CHANNEL_EVENT_TYPES.LIFECYCLE_INSTANCE_CONNECTED
      )
    ).toBe(true);
  });

  it("assigns and updates a channel membership role with an activity event", async () => {
    await connectInstance();
    const channelId = await defaultChannelId();
    const db = getDb(env);
    const targetUserId = "usr_role_target";
    const privateChannelUserId = "pcu_role_target";
    await db
      .prepare("INSERT INTO users (id, email, email_verified, status) VALUES (?, ?, 1, 'active')")
      .bind(targetUserId, "role-target@example.com")
      .run();
    await db
      .prepare(
        `INSERT INTO private_channel_users (id, organization_id, project_id, user_id)
         VALUES (?, ?, ?, ?)`
      )
      .bind(privateChannelUserId, TEST_ORG.id, TEST_PROJECT.id, targetUserId)
      .run();

    const add = await app.request(
      `/v1/private-channels/channels/${channelId}/memberships`,
      {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          privateChannelUserId,
          role: PRIVATE_CHANNEL_MEMBERSHIP_ROLES.ADMIN,
        }),
      },
      env
    );
    expect(add.status).toBe(200);

    const update = await app.request(
      `/v1/private-channels/channels/${channelId}/memberships/${privateChannelUserId}`,
      {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({ role: PRIVATE_CHANNEL_MEMBERSHIP_ROLES.MEMBER }),
      },
      env
    );
    expect(update.status).toBe(200);

    const membership = await db
      .prepare(
        `SELECT role FROM private_channel_memberships
         WHERE channel_id = ? AND private_channel_user_id = ?`
      )
      .bind(channelId, privateChannelUserId)
      .first<{ role: string }>();
    expect(membership?.role).toBe(PRIVATE_CHANNEL_MEMBERSHIP_ROLES.MEMBER);

    const events = await app.request(
      `/v1/private-channels/channels/${channelId}/events?type=${PRIVATE_CHANNEL_EVENT_TYPES.MEMBER_ROLE_CHANGED}`,
      { headers: authHeaders() },
      env
    );
    const body = (await events.json()) as { data: PrivateChannelEventListEnvelope };
    expect(body.data.events).toHaveLength(1);
    expect(body.data.events[0]?.payload).toMatchObject({
      privateChannelUserId,
      oldRole: PRIVATE_CHANNEL_MEMBERSHIP_ROLES.ADMIN,
      newRole: PRIVATE_CHANNEL_MEMBERSHIP_ROLES.MEMBER,
    });
  });

  it("hides project and channel events from a non-admin API key", async () => {
    await connectInstance();
    const channelId = await defaultChannelId();
    const headers = await nonAdminAuthHeaders();

    const projectFeed = await app.request("/v1/private-channels/events", { headers }, env);
    expect(projectFeed.status).toBe(200);
    const projectBody = (await projectFeed.json()) as { data: PrivateChannelEventListEnvelope };
    expect(projectBody.data.events).toEqual([]);

    const channelFeed = await app.request(
      `/v1/private-channels/channels/${channelId}/events`,
      { headers },
      env
    );
    expect(channelFeed.status).toBe(403);
  });

  it("shows a member only events from their channels", async () => {
    await connectInstance();
    const channelId = await defaultChannelId();
    const createOther = await app.request(
      "/v1/private-channels/channels",
      {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ name: "Other" }),
      },
      env
    );
    const other = (await createOther.json()) as { data: PrivateChannelDto };
    const { headers } = await memberSession(channelId);

    const projectFeed = await app.request("/v1/private-channels/events", { headers }, env);
    expect(projectFeed.status).toBe(200);
    const projectBody = (await projectFeed.json()) as { data: PrivateChannelEventListEnvelope };
    expect(projectBody.data.events.length).toBeGreaterThan(0);
    expect(projectBody.data.events.every((event) => event.channelId === channelId)).toBe(true);

    const ownFeed = await app.request(
      `/v1/private-channels/channels/${channelId}/events`,
      { headers },
      env
    );
    expect(ownFeed.status).toBe(200);

    const otherFeed = await app.request(
      `/v1/private-channels/channels/${other.data.id}/events`,
      { headers },
      env
    );
    expect(otherFeed.status).toBe(403);
  });

  it("lets a channel admin change another member's role", async () => {
    await connectInstance();
    const channelId = await defaultChannelId();
    const { headers } = await memberSession(channelId, "admin");
    const db = getDb(env);
    await db
      .prepare("INSERT INTO users (id, email, email_verified, status) VALUES (?, ?, 1, 'active')")
      .bind("usr_admin_target", "admin-target@example.com")
      .run();
    await db
      .prepare(
        `INSERT INTO private_channel_users (id, organization_id, project_id, user_id)
         VALUES ('pcu_admin_target', ?, ?, 'usr_admin_target')`
      )
      .bind(TEST_ORG.id, TEST_PROJECT.id)
      .run();
    await db
      .prepare(
        `INSERT INTO private_channel_memberships
           (id, channel_id, private_channel_user_id, role)
         VALUES ('pcm_admin_target', ?, 'pcu_admin_target', 'member')`
      )
      .bind(channelId)
      .run();

    const response = await app.request(
      `/v1/private-channels/channels/${channelId}/memberships/pcu_admin_target`,
      {
        method: "PATCH",
        headers,
        body: JSON.stringify({ role: PRIVATE_CHANNEL_MEMBERSHIP_ROLES.ADMIN }),
      },
      env
    );
    expect(response.status).toBe(200);
  });

  it("blocks a member from changing roles but allows self-leave", async () => {
    await connectInstance();
    const channelId = await defaultChannelId();
    const { headers, privateChannelUserId } = await memberSession(channelId);

    const update = await app.request(
      `/v1/private-channels/channels/${channelId}/memberships/${privateChannelUserId}`,
      {
        method: "PATCH",
        headers,
        body: JSON.stringify({ role: PRIVATE_CHANNEL_MEMBERSHIP_ROLES.ADMIN }),
      },
      env
    );
    expect(update.status).toBe(403);

    const leave = await app.request(
      `/v1/private-channels/channels/${channelId}/memberships/${privateChannelUserId}`,
      { method: "DELETE", headers },
      env
    );
    expect(leave.status).toBe(200);
  });
});
