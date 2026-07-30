import { hasPermission } from "@sdp/types";
import { type ApiKeyContext, getAuth, requireProjectId } from "@/lib/auth";
import type { AppContext } from "./context";
import {
  getPrivateChannelUserRepository,
  getPrivateChannelVerifiedWalletRepository,
} from "./context";

export type EventViewer =
  | { scope: "all" }
  | { scope: "wallets"; wallets: string[] }
  | { scope: "none" };

interface EventViewerResolverDependencies {
  findPrivateChannelUser(
    scope: { organizationId: string; projectId: string },
    userId: string
  ): Promise<{ id: string } | null>;
  listVerifiedWallets(
    scope: { organizationId: string; projectId: string },
    privateChannelUserId: string
  ): Promise<Array<{ pubkey: string }>>;
}

export async function resolveEventViewerForAuth(
  auth: ApiKeyContext,
  projectId: string,
  dependencies: EventViewerResolverDependencies
): Promise<EventViewer> {
  if (auth.authType === "api_key" || hasPermission(auth.permissions, "org:admin")) {
    return { scope: "all" };
  }
  if (!auth.userId) {
    return { scope: "none" };
  }

  const scope = { organizationId: auth.organizationId, projectId };
  const privateChannelUser = await dependencies.findPrivateChannelUser(scope, auth.userId);
  if (!privateChannelUser) {
    return { scope: "none" };
  }

  const verifiedWallets = await dependencies.listVerifiedWallets(scope, privateChannelUser.id);
  if (verifiedWallets.length === 0) {
    return { scope: "none" };
  }
  return { scope: "wallets", wallets: verifiedWallets.map((wallet) => wallet.pubkey) };
}

export async function resolveEventViewer(c: AppContext): Promise<EventViewer> {
  const auth = getAuth(c);
  const projectId = requireProjectId(c);
  const userRepository = getPrivateChannelUserRepository(c);
  const walletRepository = getPrivateChannelVerifiedWalletRepository(c);

  return resolveEventViewerForAuth(auth, projectId, {
    findPrivateChannelUser: (scope, userId) => userRepository.findByProjectAndUser(scope, userId),
    listVerifiedWallets: (scope, privateChannelUserId) =>
      walletRepository.listByProjectAndUser(scope, privateChannelUserId),
  });
}
