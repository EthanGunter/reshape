/**
 * Type-level tests. These are checked by `tsc --noEmit` and emit nothing.
 * A `@ts-expect-error` here fails the build if the error STOPS happening,
 * so the negative cases are real assertions, not comments.
 */
import { reshape } from "../src/index.js";

type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

type Row = {
	_id: string;
	_creationTime: number;
	authId: string;
	name: string;
	email: string;
	passwordHash: string;
	profile: { bio: string; internal_score: number; avatar_url: string };
	posts: { id: string; title: string; draft_body: string }[];
};

/* --------------------- the headline: ReturnType is the type -------------- */

const toPublicUser = reshape<Row>()
	.omit("_id", "passwordHash")
	.rename({ authId: "id", _creationTime: "createdAt" })
	.retype({ createdAt: (t) => new Date(t) })
	.extend({ fullName: (u) => `${u.name} <${u.email}>`, source: "api" as const })
	.at("profile", (r) => r.pick("bio", "avatar_url"))
	.each("posts", (r) => r.pick("id", "title"))
	.build();

type PublicUser = ReturnType<typeof toPublicUser>;

type _shape = Expect<Equals<PublicUser, {
	id: string;
	createdAt: Date;
	name: string;
	email: string;
	fullName: string;
	source: "api";
	profile: { bio: string; avatar_url: string };
	posts: { id: string; title: string }[];
}>>;

/* ------------------------------ key safety ------------------------------ */

// @ts-expect-error not a key of Row
reshape<Row>().pick("nope");
// @ts-expect-error already removed by the previous step
reshape<Row>().omit("email").rename({ email: "mail" });
// @ts-expect-error retype must name a key that still exists
reshape<Row>().pick("name").retype({ email: (e: string) => e });

/* --------------------- extend: contextual typing ------------------------ */

const computed = reshape<{ first: string; last: string }>()
	// `u` must be contextually typed here, with no annotation
	.extend({ full: (u) => `${u.first} ${u.last}` })
	.build();
type _computed = Expect<Equals<ReturnType<typeof computed>, { first: string; last: string; full: string }>>;

const stored = reshape<{ a: number }>().extend({ fn: () => Math.max }).build();
type _stored = Expect<Equals<ReturnType<typeof stored>["fn"], (...values: number[]) => number>>;

/* ------------------------------- unions --------------------------------- */

type AppEvent = { kind: "click"; x: number; id: string } | { kind: "key"; code: string; id: string };

const events = reshape<AppEvent>().retype({ id: (s) => Number(s) }).build();
type OutEvent = ReturnType<typeof events>;

// the union survives as a union, so it is still discriminable
type _union = Expect<Equals<OutEvent,
	| { kind: "click"; x: number; id: number }
	| { kind: "key"; code: string; id: number }
>>;

declare const e: OutEvent;
if (e.kind === "click") { const _x: number = e.x; } else { const _c: string = e.code; }

// @ts-expect-error keyof (A | B) is only the SHARED keys -- branch first
reshape<AppEvent>().pick("x");

/* ------------------------------- invert --------------------------------- */

// pure key remapping: no recipe required, total inverse
const pure = reshape<{ authId: string; name: string }>().rename({ authId: "id" });
type _pureInv = Expect<Equals<ReturnType<typeof pure.invert>, (value: { id: string; name: string }) => { authId: string; name: string }>>;

const convex = reshape<Row>()
	.omit("passwordHash", "_id")
	.rename({ authId: "id", _creationTime: "createdAt" })
	.retype({ createdAt: (t) => new Date(t) });

// @ts-expect-error createdAt was transformed one-way; its inverse is mandatory
convex.invert();
// @ts-expect-error ...even when reconstructors for dropped fields are supplied
convex.invert({ _id: () => "x", passwordHash: () => "" });

// @ts-expect-error a recipe key matching nothing is a typo, not a no-op
convex.invert({ createdAt: (d) => d.getTime(), passwordHsh: () => "" });

// incomplete recipe -> patch inverse
const patch = convex.invert({ createdAt: (d) => d.getTime() });
type _patch = Expect<Equals<Parameters<typeof patch>[0], Partial<{
	id: string; createdAt: Date; name: string; email: string;
	profile: Row["profile"]; posts: Row["posts"];
}>>>;
type _patchOut = Expect<Equals<ReturnType<typeof patch>, Partial<Row>>>;

// complete recipe -> total inverse
const total = convex.invert({
	createdAt: (d) => d.getTime(),
	_id: () => "generated",
	passwordHash: () => "",
});
type _totalOut = Expect<Equals<ReturnType<typeof total>, Row>>;

// the reverse function's parameter is inferred from the forward transform
const _inferred = convex.invert({ createdAt: (d) => d.getTime() });

// Provenance is order-independent: renaming BEFORE dropping still knows that
// `id` came from `authId`, so no reconstructor is demanded for it. Supplying
// exactly the genuinely-dropped fields is enough for a total inverse.
const reordered = reshape<Row>().rename({ authId: "id" }).pick("id", "name");

const reorderedTotal = reordered.invert({
	_id: () => "x",
	_creationTime: () => 0,
	email: () => "",
	passwordHash: () => "",
	profile: () => ({ bio: "", internal_score: 0, avatar_url: "" }),
	posts: () => [],
});
type _reordered = Expect<Equals<ReturnType<typeof reorderedTotal>, Row>>;

// ...and omitting one of them degrades to a patch inverse rather than erroring
const reorderedPatch = reordered.invert({ _id: () => "x" });
type _reorderedPatch = Expect<Equals<ReturnType<typeof reorderedPatch>, Partial<Row>>>;

// A superfluous reconstructor key is rejected. `NoExtraKeys` restores the
// excess-property check that inference through a naked type parameter loses,
// so a key that is neither transformed nor dropped fails at the property
// rather than being silently skipped at runtime.
// @ts-expect-error authId is not a dropped or transformed key
reordered.invert({ authId: () => "ignored" });

/* ---------------------- invert(): no-recipe regression ------------------- */

// Regression: with no argument, `R` falls back to its constraint, whose
// optional reconstructor keys made the completeness check read as satisfied --
// so a pipeline that had dropped fields wrongly promised a TOTAL inverse.
const droppedNoRecipe = reshape<Row>().omit("passwordHash", "_id").rename({ authId: "id" });
const noRecipe = droppedNoRecipe.invert();

type _noRecipeIsPatch = Expect<Equals<ReturnType<typeof noRecipe>, Partial<Row>>>;
type _noRecipeTakesPartial = Expect<Equals<Parameters<typeof noRecipe>[0], Partial<{
	id: string; _creationTime: number; name: string; email: string;
	profile: Row["profile"]; posts: Row["posts"];
}>>>;

// A pipeline that drops nothing still inverts totally with no recipe.
const dropsNothing = reshape<{ a: string; b: number }>().rename({ a: "x" });
type _totalNoRecipe = Expect<Equals<
	ReturnType<ReturnType<typeof dropsNothing.invert>>, { a: string; b: number }
>>;
