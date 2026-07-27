// Seeds test users end-to-end using CLERK_SECRET_KEY:
//   1. Creates the user in Clerk (real Clerk identity → real login works).
//   2. Adds them to the SDP org's Clerk organization.
//   3. Backfills SDP DB rows (users, auth_user_identities, organization_members,
//      project_members) — mirrors what the Clerk webhook would do if it fired.
//
// Prints login credentials so you can sign in as the seeded user.
//
// Usage (from repo root):
//   pnpm --filter @sdp/api tsx scripts/seed-clerk-dev-users.ts
//   pnpm --filter @sdp/api tsx scripts/seed-clerk-dev-users.ts --list
//   pnpm --filter @sdp/api tsx scripts/seed-clerk-dev-users.ts --emails a@x.com,b@x.com
//   pnpm --filter @sdp/api tsx scripts/seed-clerk-dev-users.ts --emails tolav77747@luckfeed.com
//   pnpm --filter @sdp/api tsx scripts/seed-clerk-dev-users.ts --project-id prj_xxx --password 'MyPass!'
//
// Idempotent: existing Clerk users are re-used; existing DB rows are left alone.
// --list only prints the project's current members without touching anything.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDatabaseClient } from "../src/db";

// `example.com` is IANA-reserved for documentation — always passes email
// validators (like Clerk's) but is guaranteed undeliverable, which is what we
// want for local test users.
const DEFAULT_EMAILS = [
  "dev-alice@example.com",
  "dev-bob@example.com",
  "dev-carol@example.com",
  "dev-dan@example.com",
];
const DEFAULT_PASSWORD = "DevTest-Pass-1234!";

function loadLocalEnvFile(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) return {};
  const values: Record<string, string> = {};
  for (const line of fs.readFileSync(filePath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const [key, ...rest] = trimmed.split("=");
    if (!key) continue;
    values[key] = rest.join("=");
  }
  return values;
}

function readArg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
}

function nameFromEmail(email: string): { first: string; last: string } {
  const local = email.split("@")[0] ?? email;
  const parts = local.split(/[._-]+/).filter(Boolean);
  const first = (parts[0] ?? "Dev").charAt(0).toUpperCase() + (parts[0] ?? "Dev").slice(1);
  const last = parts.length > 1 ? parts.slice(1).map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join(" ") : "Tester";
  return { first, last };
}

function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

interface ClerkClient {
  request<T>(path: string, options?: RequestInit): Promise<T>;
}

function makeClerkClient(secretKey: string, apiBase: string): ClerkClient {
  return {
    async request<T>(path: string, options: RequestInit = {}): Promise<T> {
      const res = await fetch(`${apiBase}${path}`, {
        ...options,
        headers: {
          Authorization: `Bearer ${secretKey}`,
          "Content-Type": "application/json",
          ...(options.headers || {}),
        },
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Clerk ${options.method ?? "GET"} ${path} → ${res.status}: ${body}`);
      }
      if (res.status === 204) return {} as T;
      return (await res.json()) as T;
    },
  };
}

interface ClerkUser {
  id: string;
  email_addresses: { email_address: string }[];
}

async function findOrCreateClerkUser(
  clerk: ClerkClient,
  email: string,
  password: string
): Promise<{ user: ClerkUser; created: boolean }> {
  // GET /v1/users returns a raw ClerkUser[] (no { data } wrapper).
  const found = await clerk.request<ClerkUser[]>(
    `/users?email_address=${encodeURIComponent(email)}`
  );
  if (Array.isArray(found) && found.length > 0) {
    const user = found[0];
    if (!user) throw new Error("Clerk /users returned empty user");
    return { user, created: false };
  }

  const { first, last } = nameFromEmail(email);
  const user = await clerk.request<ClerkUser>("/users", {
    method: "POST",
    body: JSON.stringify({
      email_address: [email],
      password,
      first_name: first,
      last_name: last,
      skip_password_checks: true,
    }),
  });
  return { user, created: true };
}

async function ensureClerkOrgMembership(
  clerk: ClerkClient,
  clerkOrgId: string,
  clerkUserId: string
): Promise<void> {
  try {
    await clerk.request(`/organizations/${clerkOrgId}/memberships`, {
      method: "POST",
      body: JSON.stringify({ user_id: clerkUserId, role: "org:member" }),
    });
  } catch (error) {
    // Clerk returns 422 with `already_a_member_in_organization` when the user
    // is already in the org. Treat as success.
    if (error instanceof Error && /already/i.test(error.message)) return;
    throw error;
  }
}

function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) u.password = "***";
    return u.toString();
  } catch {
    return url;
  }
}

async function main() {
  console.log("[seed] starting…");
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const appDir = path.resolve(scriptDir, "..");
  const localEnv = loadLocalEnvFile(path.join(appDir, ".dev.vars"));
  const runtimeEnv = { ...localEnv, ...process.env };

  const clerkSecret = runtimeEnv.CLERK_SECRET_KEY?.trim();
  if (!clerkSecret) {
    throw new Error(
      "CLERK_SECRET_KEY is not set in .dev.vars or the environment. Cannot create Clerk users."
    );
  }
  const clerkApiBase = runtimeEnv.CLERK_API_URL?.replace(/\/$/, "") || "https://api.clerk.com/v1";
  console.log(`[seed] clerk api: ${clerkApiBase}`);
  const clerk = makeClerkClient(clerkSecret, clerkApiBase);

  const databaseUrl =
    runtimeEnv.DATABASE_URL?.trim() ??
    // biome-ignore lint/security/noSecrets: Local dev postgres.
    "postgresql://sdp:sdp@127.0.0.1:5432/sdp";
  console.log(`[seed] database: ${redactUrl(databaseUrl)}`);

  const password = readArg("--password") ?? DEFAULT_PASSWORD;
  const emailsArg = readArg("--emails");
  const emails = (emailsArg ? emailsArg.split(",") : DEFAULT_EMAILS)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (emails.length === 0) throw new Error("--emails produced no entries");
  console.log(`[seed] emails: ${emails.join(", ")}`);

  console.log(`[seed] connecting to db…`);
  const db = createDatabaseClient(databaseUrl);

  // Resolve project + Clerk org id.
  console.log(`[seed] resolving project…`);
  const requestedProjectId = readArg("--project-id")?.trim();
  const project = requestedProjectId
    ? await db
        .prepare("SELECT id, organization_id FROM projects WHERE id = ?")
        .bind(requestedProjectId)
        .first<{ id: string; organization_id: string }>()
    : await db
        .prepare(
          "SELECT id, organization_id FROM projects WHERE status = 'active' ORDER BY created_at DESC LIMIT 1"
        )
        .first<{ id: string; organization_id: string }>();
  if (!project) {
    throw new Error(
      requestedProjectId
        ? `Project ${requestedProjectId} not found`
        : "No active project in DB. Create one first or pass --project-id."
    );
  }

  const clerkOrg = await db
    .prepare(
      `SELECT provider_org_id FROM auth_organization_identities
        WHERE provider = 'clerk' AND organization_id = ?
        LIMIT 1`
    )
    .bind(project.organization_id)
    .first<{ provider_org_id: string }>();
  if (!clerkOrg) {
    throw new Error(
      `SDP org ${project.organization_id} has no Clerk identity mapping. Run through the Clerk sign-up flow at least once to bootstrap it.`
    );
  }

  console.log(
    `Seeding into SDP org=${project.organization_id} (clerk org=${clerkOrg.provider_org_id}), project=${project.id}`
  );
  console.log(`Login password for all seeded users: ${password}\n`);

  for (const email of emails) {
    console.log(`- ${email}`);

    // Clerk-side: user + org membership.
    const { user: clerkUser, created } = await findOrCreateClerkUser(clerk, email, password);
    console.log(`    clerk user ${created ? "created " : "reused  "} (${clerkUser.id})`);
    await ensureClerkOrgMembership(clerk, clerkOrg.provider_org_id, clerkUser.id);
    console.log(`    clerk org membership ensured`);

    // SDP DB: users → auth_user_identities → organization_members → project_members.
    const existingUser = await db
      .prepare(
        `SELECT u.id AS id
           FROM users u
           LEFT JOIN auth_user_identities aui
             ON aui.user_id = u.id AND aui.provider = 'clerk'
          WHERE u.email = ? OR aui.provider_user_id = ?
          LIMIT 1`
      )
      .bind(email, clerkUser.id)
      .first<{ id: string }>();

    let userId: string;
    if (existingUser) {
      userId = existingUser.id;
    } else {
      userId = newId("usr");
      const { first, last } = nameFromEmail(email);
      await db
        .prepare(
          `INSERT INTO users (id, email, email_verified, name, status)
             VALUES (?, ?, 1, ?, 'active')`
        )
        .bind(userId, email, `${first} ${last}`)
        .run();
    }

    await db
      .prepare(
        `INSERT INTO auth_user_identities (id, provider, provider_user_id, user_id, email)
           VALUES (?, 'clerk', ?, ?, ?)
         ON CONFLICT (provider, provider_user_id)
           DO UPDATE SET user_id = EXCLUDED.user_id, email = EXCLUDED.email`
      )
      .bind(newId("aui"), clerkUser.id, userId, email)
      .run();

    const orgMember = await db
      .prepare(
        `SELECT id FROM organization_members
          WHERE organization_id = ? AND user_id = ?`
      )
      .bind(project.organization_id, userId)
      .first<{ id: string }>();
    if (!orgMember) {
      await db
        .prepare(
          `INSERT INTO organization_members
             (id, organization_id, user_id, role, status)
             VALUES (?, ?, ?, 'member', 'active')`
        )
        .bind(newId("om"), project.organization_id, userId)
        .run();
    }

    const projMember = await db
      .prepare(
        `SELECT id FROM project_members
          WHERE project_id = ? AND user_id = ?`
      )
      .bind(project.id, userId)
      .first<{ id: string }>();
    if (!projMember) {
      await db
        .prepare(
          `INSERT INTO project_members (id, project_id, user_id, role)
             VALUES (?, ?, ?, 'developer')`
        )
        .bind(newId("pm"), project.id, userId)
        .run();
    }

    console.log(`    sdp usr_id=${userId}\n`);
  }

  console.log("Done. Sign in via the SDP web app using any of these emails + the password above.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

// DevTest-Pass-1234!