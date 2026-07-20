"use client";

import type {
  ListProjectMembersResponse,
  PrivateChannelDto,
  PrivateChannelUserDto,
} from "@sdp/types";
import { Loader2Icon, PlusIcon, XIcon } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Modal } from "@/components/ui/modal";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  addToChannelAction,
  deleteMemberAction,
  inviteMemberAction,
  removeFromChannelAction,
} from "./actions";

type ProjectMember = ListProjectMembersResponse["members"][number];

interface Props {
  members: PrivateChannelUserDto[];
  channels: PrivateChannelDto[];
  eligibleProjectMembers: ProjectMember[];
}

export function MembersTable({ members, channels, eligibleProjectMembers }: Props) {
  const [inviteOpen, setInviteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<PrivateChannelUserDto | null>(null);

  const invitedUserIds = useMemo(() => new Set(members.map((m) => m.userId)), [members]);
  const eligibleForInvite = useMemo(
    () => eligibleProjectMembers.filter((pm) => !invitedUserIds.has(pm.userId)),
    [eligibleProjectMembers, invitedUserIds]
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-text-medium">
          {members.length} member{members.length === 1 ? "" : "s"} invited to this workspace.
        </p>
        <Button onClick={() => setInviteOpen(true)} disabled={eligibleForInvite.length === 0}>
          Invite member
        </Button>
      </div>

      {members.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border-light p-8 text-center text-sm text-text-medium">
          No members yet. Invite an SDP project user to get started.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Verified wallets</TableHead>
              <TableHead>Channels</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((m) => (
              <MemberRow
                key={m.id}
                member={m}
                allChannels={channels}
                onDelete={() => setDeleteTarget(m)}
              />
            ))}
          </TableBody>
        </Table>
      )}

      <InviteDialog
        isOpen={inviteOpen}
        onClose={() => setInviteOpen(false)}
        candidates={eligibleForInvite}
      />

      <DeleteMemberDialog target={deleteTarget} onClose={() => setDeleteTarget(null)} />
    </div>
  );
}

function MemberRow({
  member,
  allChannels,
  onDelete,
}: {
  member: PrivateChannelUserDto;
  allChannels: PrivateChannelDto[];
  onDelete: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const inChannelIds = new Set(member.channels.map((c) => c.id));
  const notInChannels = allChannels.filter((c) => !inChannelIds.has(c.id));

  const removeFromChannel = (channelId: string) => {
    startTransition(async () => {
      const res = await removeFromChannelAction(channelId, member.id);
      if (!res.ok) toast.error(res.message);
    });
  };

  const addToChannel = (channelId: string) => {
    startTransition(async () => {
      const res = await addToChannelAction(channelId, member.id);
      if (!res.ok) toast.error(res.message);
    });
  };

  return (
    <TableRow>
      <TableCell className="font-mono text-sm break-all">{member.email}</TableCell>
      <TableCell className="text-sm">
        {member.name ?? <span className="text-text-medium">—</span>}
      </TableCell>
      <TableCell>
        <WalletCountBadge count={member.verifiedWalletCount} />
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap items-center gap-1.5">
          {member.channels.map((c) => (
            <ChannelChip
              key={c.id}
              label={c.name + (c.isDefault ? " (default)" : "")}
              onRemove={pending ? undefined : () => removeFromChannel(c.id)}
            />
          ))}
          {notInChannels.length > 0 ? (
            <AddToChannelMenu channels={notInChannels} disabled={pending} onPick={addToChannel} />
          ) : null}
        </div>
      </TableCell>
      <TableCell className="text-right">
        <Button type="button" variant="ghost" size="sm" onClick={onDelete} disabled={pending}>
          Delete
        </Button>
      </TableCell>
    </TableRow>
  );
}

function WalletCountBadge({ count }: { count: number }) {
  const hasWallets = count > 0;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-sm",
        hasWallets ? "text-status-success-text" : "text-text-medium"
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "inline-block size-2 rounded-full",
          hasWallets ? "bg-status-success-text" : "bg-border-light"
        )}
      />
      {count} verified
    </span>
  );
}

function ChannelChip({ label, onRemove }: { label: string; onRemove?: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-border-extra-light px-2 py-0.5 text-xs text-text-extra-high">
      {label}
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          className="rounded-full p-0.5 text-text-medium hover:bg-border-light hover:text-status-error-text"
          aria-label={`Remove from ${label}`}
        >
          <XIcon className="size-3" />
        </button>
      ) : null}
    </span>
  );
}

function AddToChannelMenu({
  channels,
  disabled,
  onPick,
}: {
  channels: PrivateChannelDto[];
  disabled: boolean;
  onPick: (channelId: string) => void;
}) {
  // Uses the design system's DropdownMenu (Radix) so the menu portals to the
  // document body and isn't clipped by the table's overflow container.
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className="inline-flex items-center gap-1 rounded-full border border-dashed border-border-light px-2 py-0.5 text-xs text-text-medium hover:bg-border-extra-light hover:text-text-extra-high disabled:opacity-40"
        >
          <PlusIcon className="size-3" />
          Add to channel
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[180px]">
        {channels.map((c) => (
          <DropdownMenuItem key={c.id} onSelect={() => onPick(c.id)}>
            {c.name}
            {c.isDefault ? <span className="ml-1 text-text-medium">(default)</span> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function InviteDialog({
  isOpen,
  onClose,
  candidates,
}: {
  isOpen: boolean;
  onClose: () => void;
  candidates: ProjectMember[];
}) {
  const [userId, setUserId] = useState("");
  const [pending, startTransition] = useTransition();

  const submit = () => {
    if (!userId) return;
    startTransition(async () => {
      const res = await inviteMemberAction(userId);
      if (res.ok) {
        toast.success(`Invited ${res.value.user.email}.`);
        if (res.value.inviteUrl) {
          navigator.clipboard?.writeText(res.value.inviteUrl).catch(() => {});
          toast.info("Invite URL copied to clipboard.");
        }
        setUserId("");
        onClose();
      } else {
        toast.error(res.message);
      }
    });
  };

  return (
    <Modal
      isOpen={isOpen}
      ariaLabel="Invite member"
      onClose={pending ? undefined : onClose}
      size="sm"
    >
      <div className="space-y-5 p-6">
        <div className="space-y-1">
          <h2 className="text-lg font-medium tracking-tight text-text-extra-high">Invite member</h2>
          <p className="text-sm text-text-medium">
            Pick an SDP project user to invite. An SPC credential will be created for them.
          </p>
        </div>
        <div className="grid gap-2">
          <label htmlFor="invite-user" className="text-sm font-medium text-text-high">
            Project user
          </label>
          <select
            id="invite-user"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            disabled={pending}
            className="w-full truncate rounded-md border border-border-light bg-white px-3 py-2 pr-8 text-sm text-text-extra-high"
          >
            <option value="">Select a user…</option>
            {candidates.map((pm) => (
              <option key={pm.userId} value={pm.userId} title={pm.user.name ?? pm.user.email}>
                {pm.user.email}
              </option>
            ))}
          </select>
          {(() => {
            const picked = candidates.find((pm) => pm.userId === userId);
            return picked?.user.name ? (
              <p className="truncate text-xs text-text-medium">Name: {picked.user.name}</p>
            ) : null;
          })()}
        </div>
        <div className="flex items-center justify-end gap-3">
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={submit}
            disabled={!userId || pending}
            iconLeft={pending ? <Loader2Icon className="animate-spin" /> : undefined}
          >
            {pending ? "Inviting…" : "Invite"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function DeleteMemberDialog({
  target,
  onClose,
}: {
  target: PrivateChannelUserDto | null;
  onClose: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const isOpen = target !== null;

  const confirm = () => {
    if (!target) return;
    startTransition(async () => {
      const res = await deleteMemberAction(target.id);
      if (res.ok) {
        toast.success("Member removed.");
        onClose();
      } else {
        toast.error(res.message);
      }
    });
  };

  return (
    <Modal
      isOpen={isOpen}
      ariaLabel="Delete member"
      onClose={pending ? undefined : onClose}
      size="sm"
    >
      <div className="space-y-5 p-6">
        <div className="space-y-1">
          <h2 className="text-lg font-medium tracking-tight text-text-extra-high">Remove member</h2>
          <p className="text-sm text-text-medium">
            Removes <span className="font-medium">{target?.email}</span> from the workspace and all
            channels they belong to. Their SPC credential is retained (SPC has no delete-user
            endpoint) but is orphaned from SDP.
          </p>
        </div>
        <div className="flex items-center justify-end gap-3">
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={confirm}
            disabled={pending}
            iconLeft={pending ? <Loader2Icon className="animate-spin" /> : undefined}
          >
            {pending ? "Removing…" : "Remove"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
