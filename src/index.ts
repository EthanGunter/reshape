/**
 * **Reshape** -- build type-safe transform functions from a single source of
 * truth. The types come along for free.
 *
 * @example
 * import { reshape } from "@ethangunter/reshape";
 *
 * const toPublicUser = reshape<User>()
 *   .pick("authId", "_creationTime", "name")
 *   .rename({ authId: "id", _creationTime: "createdAt" })
 *   .retype({ createdAt: (t) => new Date(t) })
 *   .build();
 *
 * type PublicUser = ReturnType<typeof toPublicUser>;
 *
 * @packageDocumentation
 */
export { reshape } from "./reshape.js";

/**
 * These are exported because your own declaration output may need to name
 * them. You should not have to write any of them by hand.
 *
 * `Built` in particular is not optional: it is what {@link reshape}'s `build`
 * returns, so a package that exports a mapper emits it into its own `.d.ts`.
 * Without it reachable from the entry point, TypeScript refuses to emit those
 * declarations at all (TS2883).
 */
export type { Built, Reshaper, Step } from "./reshape.js";
