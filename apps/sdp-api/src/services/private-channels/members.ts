// Invite orchestration: derive an SPC username, generate a strong random
// password, register with SPC, encrypt the password, insert the DB row.
// SPC /register MUST succeed before we persist so a partial invite doesn't
// leave a row without credentials.

import { PrivateChannelError, spcRegister } from "@sdp/private-channels";
import type {
  PrivateChannelUserRepository,
  PrivateChannelUserWithIdentityRow,
  ProjectScope,
} from "@/db/repositories";
import {
  createSpcCredentialCipher,
  type SpcCredentialCipherEnv,
} from "@/lib/spc-credential-crypto";

const SPC_USERNAME_MIN = 5;
const SPC_USERNAME_MAX = 32;
const SPC_PASSWORD_BYTES = 32;
const SPC_USERNAME_ALLOWED = /[^a-zA-Z0-9_-]/g;

export interface InviteMemberInput extends ProjectScope {
  authUrl: string;
  targetUserId: string;
  targetUserEmail: string;
  invitedBy: string | null;
}

export interface InviteMemberResult {
  member: PrivateChannelUserWithIdentityRow;
  /** Base64url token to embed in the invite URL. Persisted on the row. */
  inviteToken: string;
}

// email → SPC-safe username. Adds a short random suffix so collisions between
// same-email invites across projects (or a project + external SPC instance)
// don't fail the first try.
function deriveUsername(email: string): string {
  const slug = email.split("@")[0]?.replace(SPC_USERNAME_ALLOWED, "-") ?? "user";
  const base = slug.replace(/^-+|-+$/g, "").slice(0, SPC_USERNAME_MAX - 6);
  const seed = base.length >= SPC_USERNAME_MIN - 6 ? base : `user-${base}`;
  const suffix = Math.random().toString(36).slice(2, 7);
  return `${seed}-${suffix}`.slice(0, SPC_USERNAME_MAX);
}

function generatePassword(): string {
  const bytes = new Uint8Array(SPC_PASSWORD_BYTES);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
}

function generateInviteToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
}

export async function inviteMember(
  env: SpcCredentialCipherEnv,
  repo: PrivateChannelUserRepository,
  input: InviteMemberInput
): Promise<InviteMemberResult> {
  // Dup check: prevents burning an SPC username on a doomed insert.
  const existing = await repo.findByProjectAndUser(input, input.targetUserId);
  if (existing) {
    throw new PrivateChannelError(
      "CONFLICT",
      "User is already invited to this Private Channels workspace."
    );
  }

  const password = generatePassword();
  const cipher = createSpcCredentialCipher(env);
  const ciphertext = await cipher.encrypt(input.organizationId, password);

  // Retry once on collision: SPC hard-fails on duplicate username; the random
  // suffix makes second-attempt collisions effectively impossible.
  let username = deriveUsername(input.targetUserEmail);
  let registered: Awaited<ReturnType<typeof spcRegister>>;
  try {
    registered = await spcRegister(input.authUrl, { username, password });
  } catch (err) {
    if (err instanceof PrivateChannelError && err.code === "CONFLICT") {
      username = deriveUsername(input.targetUserEmail);
      registered = await spcRegister(input.authUrl, { username, password });
    } else {
      throw err;
    }
  }

  const inviteToken = generateInviteToken();
  const member = await repo.create({
    organizationId: input.organizationId,
    projectId: input.projectId,
    userId: input.targetUserId,
    spcUserId: registered.id,
    spcUsername: registered.username,
    spcCredentialCiphertext: ciphertext,
    invitedBy: input.invitedBy,
    inviteToken,
  });

  return { member, inviteToken };
}
