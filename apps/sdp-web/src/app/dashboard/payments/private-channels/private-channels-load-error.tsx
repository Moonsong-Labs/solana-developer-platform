/**
 * Inline "this section failed to load" notice.
 *
 * Mirrors the error-surface classes used across the ramps flows
 * (`border-error-border bg-error-bg text-error`); it exists as a component only
 * because every Private Channels page needs the same one.
 */
export function PrivateChannelsLoadError({ message }: { message?: string }) {
  return (
    <div className="rounded-lg border border-error-border bg-error-bg px-4 py-3 text-sm text-error">
      {message ?? "Something went wrong loading this section."}
    </div>
  );
}
