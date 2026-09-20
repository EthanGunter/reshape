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
 * them. You should not have to write either by hand.
 */
export type { Reshaper, Step } from "./reshape.js";
