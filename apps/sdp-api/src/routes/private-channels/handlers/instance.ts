import {
  PRIVATE_CHANNEL_EVENT_TYPES,
  type PrivateChannelInstanceEnvelope,
  type PrivateChannelInstanceResponse,
} from "@sdp/types";
import { z } from "zod";
import { mapPrivateChannelInstanceRow, type PrivateChannelInstanceRow } from "@/db/repositories";
import { getAuth, requireProjectId } from "@/lib/auth";
import { AppError, badRequest, notFound } from "@/lib/errors";
import { success } from "@/lib/response";
import { verifyInstanceConnection } from "@/services/private-channels";
import type { AppContext } from "../context";
import {
  getPrivateChannelDepositRepository,
  getPrivateChannelInstanceRepository,
  getPrivateChannelRepository,
  getPrivateChannelWithdrawalRepository,
} from "../context";
import { emitLifecycle } from "../helpers";
import { connectPrivateChannelInstanceSchema } from "../schemas";

export const getPrivateChannelInstance = async (c: AppContext) => {
  const auth = getAuth(c);
  const projectId = requireProjectId(c);

  const repo = getPrivateChannelInstanceRepository(c);
  const row = await repo.getActiveByProject({
    organizationId: auth.organizationId,
    projectId,
  });

  const response: PrivateChannelInstanceEnvelope = {
    instance: row ? mapPrivateChannelInstanceRow(row) : null,
  };
  return success(c, response);
};

export const connectPrivateChannelInstance = async (c: AppContext) => {
  const auth = getAuth(c);
  const projectId = requireProjectId(c);

  const body = await c.req.json();
  const parsed = connectPrivateChannelInstanceSchema.safeParse(body);
  if (!parsed.success) {
    throw badRequest("Invalid connection details", {
      fieldErrors: z.flattenError(parsed.error).fieldErrors,
    });
  }
  const { confirmReactivate, ...input } = parsed.data;

  const repo = getPrivateChannelInstanceRepository(c);
  const scope = { organizationId: auth.organizationId, projectId };

  const active = await repo.getActiveByProject(scope);
  if (active) {
    // DB partial unique index is the real backstop against a racing double-Connect.
    throw new AppError(
      "CONFLICT",
      "This project already has an active Private Channel instance. Disconnect it before connecting a new one.",
      { activeInstance: mapPrivateChannelInstanceRow(active) }
    );
  }

  // Re-probe server-side: a tampered client could otherwise POST unreachable config.
  const probe = await verifyInstanceConnection({
    gatewayUrl: input.gatewayUrl,
    chainRpcUrl: input.chainRpcUrl,
  });
  if (!probe.ok) {
    // AppError responses are returned silently by app.onError; log diagnostics here.
    console.warn("connectPrivateChannelInstance: connection probe failed", {
      organizationId: auth.organizationId,
      projectId,
      gatewayUrl: input.gatewayUrl,
      chainRpcUrl: input.chainRpcUrl,
      gateway: probe.gateway,
      rpc: probe.rpc,
    });
    throw badRequest("Connection check failed", {
      gateway: probe.gateway,
      rpc: probe.rpc,
    });
  }

  const existingByGateway = await repo.findByProjectAndGateway({
    ...scope,
    gatewayUrl: input.gatewayUrl,
  });

  let row: PrivateChannelInstanceRow | null;
  if (existingByGateway) {
    if (!confirmReactivate) {
      throw new AppError(
        "CONFLICT",
        "This gateway URL was previously connected to this project. Confirm to overwrite its config and reactivate.",
        {
          requiresReactivateConfirmation: true,
          existingInstance: mapPrivateChannelInstanceRow(existingByGateway),
        }
      );
    }
    row = await repo.reactivateAndUpdate({ id: existingByGateway.id, ...input });
  } else {
    row = await repo.createActive({
      ...scope,
      createdBy: auth.userId ?? null,
      ...input,
    });
  }

  if (!row) {
    throw badRequest("Failed to persist the private channel instance.");
  }

  await emitLifecycle(c, row, PRIVATE_CHANNEL_EVENT_TYPES.LIFECYCLE_INSTANCE_CONNECTED, {
    payload: { gatewayUrl: row.gateway_url },
  });

  // Ensure the instance's default channel exists once connected. Idempotent +
  // best-effort: a hiccup here must not fail the connect (the channels list
  // endpoint ensures the default too). Emitted after connect so the feed reads
  // in chronological order.
  try {
    const { channel, created } = await getPrivateChannelRepository(c).getOrCreateDefault({
      instanceId: row.id,
      organizationId: row.organization_id,
      projectId: row.project_id,
    });
    if (created) {
      await emitLifecycle(c, row, PRIVATE_CHANNEL_EVENT_TYPES.LIFECYCLE_CHANNEL_CREATED, {
        channelId: channel.id,
        payload: { name: channel.name, isDefault: true },
      });
    }
  } catch (error) {
    console.warn("connectPrivateChannelInstance: failed to ensure default channel", {
      organizationId: auth.organizationId,
      projectId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const response: PrivateChannelInstanceResponse = {
    instance: mapPrivateChannelInstanceRow(row),
  };
  return success(c, response);
};

export const disconnectPrivateChannelInstance = async (c: AppContext) => {
  const auth = getAuth(c);
  const projectId = requireProjectId(c);

  const repo = getPrivateChannelInstanceRepository(c);
  const row = await repo.deactivateActive({
    organizationId: auth.organizationId,
    projectId,
  });
  if (!row) {
    throw notFound("Active private channel instance");
  }

  await emitLifecycle(c, row, PRIVATE_CHANNEL_EVENT_TYPES.LIFECYCLE_INSTANCE_DISCONNECTED, {
    payload: { gatewayUrl: row.gateway_url },
  });

  const response: PrivateChannelInstanceResponse = {
    instance: mapPrivateChannelInstanceRow(row),
  };
  return success(c, response);
};

export const deletePrivateChannelInstance = async (c: AppContext) => {
  const auth = getAuth(c);
  const projectId = requireProjectId(c);

  const repo = getPrivateChannelInstanceRepository(c);
  const scope = { organizationId: auth.organizationId, projectId };
  const active = await repo.getActiveByProject(scope);
  if (!active) {
    throw notFound("Active private channel instance");
  }

  // Deposits and withdrawals are financial records that survive instance deletion,
  // but deleting an instance with IN-FLIGHT money movements would strand their
  // reconciliation. Reject it while any are non-terminal.
  //
  // TODO(disconnect-drain): this count->delete is check-then-act, so a deposit or
  // withdrawal created between the two still slips through and gets stranded. The
  // guard is worth having (it catches the common case) but it is not a barrier. The
  // real fix is a draining/read-only state on the instance: flip it first so no new
  // deposits or transfers are accepted, let the in-flight set settle, then allow the
  // delete — which also gives the operator a way to disconnect deliberately instead
  // of retrying against a moving target.
  const [depositsInFlight, withdrawalsInFlight] = await Promise.all([
    getPrivateChannelDepositRepository(c).countNonTerminalByInstance(active.id),
    getPrivateChannelWithdrawalRepository(c).countNonTerminalByInstance(active.id),
  ]);
  if (depositsInFlight > 0 || withdrawalsInFlight > 0) {
    throw new AppError(
      "CONFLICT",
      `Cannot delete this instance: ${depositsInFlight} deposit(s) and ${withdrawalsInFlight} withdrawal(s) are still in flight. Wait for them to settle or fail first.`
    );
  }

  await emitLifecycle(c, active, PRIVATE_CHANNEL_EVENT_TYPES.LIFECYCLE_INSTANCE_DISCONNECTED, {
    payload: { gatewayUrl: active.gateway_url, reason: "deleted" },
  });

  const deleted = await repo.deleteActive(scope);
  if (!deleted) {
    throw notFound("Active private channel instance");
  }

  return success(c, { deleted: true });
};
