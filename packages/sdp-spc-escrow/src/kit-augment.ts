/**
 * Kit version shim.
 *
 * `@codama/renderers-js` (2.3) references the `ExtendedClient` return type of
 * `extendClient` in the generated program-client plugin. The repo's pinned
 * `@solana/kit` (6.8) ships `extendClient` at runtime but not that type export
 * (it lands in kit 6.9+). Augment `@solana/kit` with a permissive definition so
 * the generated program helper type-checks. The deposit flow does not use that
 * plugin. Remove this once the repo's `@solana/kit` exports `ExtendedClient`.
 *
 * Imported for side effects by `./index` so the augmentation is in scope
 * wherever the generated client is compiled (including consumers, which build
 * through this package's source).
 */

declare module "@solana/kit" {
  // extendClient(client, ext) returns the client with `ext` merged in (ext keys win).
  export type ExtendedClient<TClient, TExtensions> = Omit<TClient, keyof TExtensions> & TExtensions;
}

export {};
