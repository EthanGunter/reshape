import type {
	DistributiveOmit, DistributivePick, Extended, FieldSpec,
	RenameKeys, Retype, Simplify,
} from "./types.js";

/* ------------------------------------------------------------------ *
 * Provenance
 *
 * `Src` maps each key of the CURRENT shape back to the key of the ORIGINAL
 * source it came from. Renaming rewrites the map, dropping removes entries,
 * and `extend` adds entries with no source (`never`). Anything in the source
 * that no longer appears as a value in the map was dropped, which is exactly
 * what `invert` needs a reconstructor for -- no matter what order the
 * operations were applied in.
 * ------------------------------------------------------------------ */

type Provenance = Record<PropertyKey, PropertyKey>;

type DroppedKeys<In, Src extends Provenance> = Exclude<keyof In, Src[keyof Src]>;

type RenameProvenance<Src extends Provenance, M> = {
	[K in keyof Src as K extends keyof M ? (M[K] extends string ? M[K] : K) : K]: Src[K];
};

/**
 * What `invert` still needs from you.
 *   - a value-inverse for every one-way `retype` (mandatory: such a key can
 *     appear in any input, including a patch)
 *   - a reconstructor for every dropped source key (optional: supply them all
 *     for a total inverse, supply none for a patch inverse)
 */
type Recipe<In, Out, Src extends Provenance, NeedsFn extends PropertyKey> =
	{ [K in Extract<NeedsFn, keyof Out>]: (value: Out[K]) => unknown } &
	{ [K in DroppedKeys<In, Src>]?: (current: Out) => In[K] };

/**
 * Maps any recipe key that corresponds to nothing to `never`, so a typo is a
 * compile error at the offending property rather than a silent no-op. The
 * parameter is a naked type parameter, so freshness -- and with it TypeScript's
 * own excess property check -- is lost through inference; this puts it back.
 */
type NoExtraKeys<R, Allowed> = {
	[K in keyof R]: K extends keyof Allowed ? R[K] : never;
};

/**
 * Keys a recipe actually SUPPLIED. `keyof R` is not enough: when `invert()` is
 * called with no argument, `R` falls back to its constraint, whose optional
 * reconstructor keys would otherwise read as "provided" and wrongly promise a
 * total inverse. Keys of an inferred object literal are required; keys of the
 * fallback constraint are optional.
 */
type SuppliedKeys<T> = { [K in keyof T]-?: {} extends Pick<T, K> ? never : K }[keyof T];

type InverseOf<In, Out, Src extends Provenance, R> =
	[Exclude<DroppedKeys<In, Src>, SuppliedKeys<R>>] extends [never]
	? (value: Out) => Simplify<In>
	: (patch: Partial<Out>) => Partial<Simplify<In>>;

/** One step of a compiled pipeline, as reported by {@link Reshaper.explain}. */
export type Step =
	| { op: "pick"; keys: string[] }
	| { op: "omit"; keys: string[] }
	| { op: "rename"; mapping: Record<string, string> }
	| { op: "extend"; keys: string[]; computed: string[] }
	| { op: "retype"; keys: string[] }
	| { op: "at"; key: string; steps: Step[] }
	| { op: "each"; key: string; steps: Step[] };

const BRAND: unique symbol = Symbol.for("@ethangunter/reshape");

/**
 * A pipeline under construction. Every method returns a new reshaper, so
 * pipelines are immutable and safe to share.
 *
 * Only the first type parameter is meant to be written by hand
 * (`Reshaper<User>`); the rest are inferred as you chain, and track the
 * current shape, where each key came from, and which values were transformed
 * one-way. You rarely need to name this type -- prefer `ReturnType<typeof fn>`
 * on the result of {@link Reshaper.build}.
 */
export type Reshaper<
	In,
	Out = In,
	Src extends Provenance = { [K in keyof In]: K },
	NeedsFn extends PropertyKey = never
> = {
	readonly [BRAND]: true;

	/**
	 * Keep only these keys and drop the rest.
	 *
	 * The result is built from this list, so a key that exists on the object at
	 * runtime but not in its type cannot survive -- it is never read. Prefer
	 * this over {@link Reshaper.omit} anywhere data leaves your control.
	 */
	pick<K extends keyof Out>(...keys: K[]): Reshaper<
		In, DistributivePick<Out, K>, Pick<Src, Extract<K, keyof Src>>, Extract<NeedsFn, K>
	>;

	/**
	 * Remove these keys and let everything else through.
	 *
	 * Only removes what the type knows about. Fields present at runtime but
	 * missing from the type -- a new column, an untyped document -- are not
	 * removed, because TypeScript erases and nothing at runtime knows they were
	 * unexpected. Use {@link Reshaper.pick} at a trust boundary.
	 */
	omit<K extends keyof Out>(...keys: K[]): Reshaper<
		In, DistributiveOmit<Out, K>, Omit<Src, K>, Exclude<NeedsFn, K>
	>;

	/**
	 * Rename keys, as `{ oldKey: "newKey" }`.
	 *
	 * Values are staged before being written, so a straight swap
	 * (`{ a: "b", b: "a" }`) will not clobber. Reversible: {@link Reshaper.invert}
	 * undoes a rename without being told how.
	 */
	rename<const M extends Partial<Record<keyof Out, string>>>(mapping: M): Reshaper<
		In, RenameKeys<Out, M>, RenameProvenance<Src, M>, NeedsFn
	>;

	/**
	 * Add fields to the shape.
	 *
	 * A value is either a static, or a function of the current shape -- which
	 * is how you derive a field from several others. To store a function *as* a
	 * value rather than calling it, return it: `{ handler: () => myFn }`.
	 */
	extend<const U extends Record<string, FieldSpec<Out>>>(fields: U): Reshaper<
		In, Simplify<Out & Extended<Out, U>>, Src & { [K in keyof U]: never }, NeedsFn
	>;

	/**
	 * Transform values in place, as `{ key: (value) => next }`. The new type is
	 * whatever your function returns.
	 *
	 * One-way: {@link Reshaper.invert} will require the reverse function for
	 * every key named here.
	 */
	retype<const F extends Partial<{ [K in keyof Out]: (value: Out[K]) => unknown }>>(
		fns: F
	): Reshaper<In, Retype<Out, F>, Src, NeedsFn | keyof F>;

	/**
	 * Reshape a nested object. Takes another reshaper, so a mapper defined once
	 * can be reused wherever that shape appears, or a callback receiving a
	 * reshaper for the nested type.
	 */
	at<K extends keyof Out, R>(
		key: K,
		reshaper: R | ((nested: Reshaper<Out[K]>) => R)
	): Reshaper<In, Simplify<DistributiveOmit<Out, K> & Record<K, OutputOf<R>>>, Src, NeedsFn | K>;

	/** Reshape every element of a nested array, the way {@link Reshaper.at} reshapes a nested object. */
	each<K extends KeysOfArrays<Out>, R>(
		key: K,
		reshaper: R | ((element: Reshaper<ElementOf<Out[K]>>) => R)
	): Reshaper<In, Simplify<DistributiveOmit<Out, K> & Record<K, OutputOf<R>[]>>, Src, NeedsFn | K>;

	/**
	 * Compile the pipeline into a plain function -- the thing this library
	 * exists to produce.
	 *
	 * Name it and its return type *is* your derived type, with nothing written
	 * by hand: `type PublicUser = ReturnType<typeof toPublicUser>`. Being an
	 * ordinary function, it also drops straight into `.map()`.
	 */
	build(): (source: In) => Simplify<Out>;

	/** Apply the pipeline once, for when the function is not worth naming. */
	run(source: In): Simplify<Out>;

	/**
	 * Reverse the pipeline, for turning an outbound shape back into the shape
	 * your database or API expects.
	 *
	 * Key remapping reverses on its own. Anything else is asked for in
	 * `recipe`, and the compiler names exactly what is missing:
	 *
	 * - every one-way {@link Reshaper.retype} needs its reverse function, and
	 *   these are mandatory, because such a key can appear in any input
	 * - every dropped field may take a reconstructor. Supply them all and you
	 *   get a total inverse; supply none and you get a **patch inverse**, which
	 *   maps only the keys actually present -- usually what a granular update
	 *   wants
	 *
	 * A key absent from the input is never emitted as `undefined`, since a
	 * document store reads that as an instruction to unset the field.
	 */
	invert<const R extends Recipe<In, Out, Src, NeedsFn>>(
		...args: [Extract<NeedsFn, keyof Out>] extends [never]
			? [recipe?: R & NoExtraKeys<R, Recipe<In, Out, Src, NeedsFn>>]
			: [recipe: R & NoExtraKeys<R, Recipe<In, Out, Src, NeedsFn>>]
	): InverseOf<In, Out, Src, R>;

	/**
	 * The compiled plan as plain data, in order. Useful for asserting in tests
	 * that a mapper drops what you think it drops.
	 */
	explain(): Step[];
};

type OutputOf<R> = R extends Reshaper<any, infer O, any, any> ? O : R extends (input: any) => infer O ? O : never;
type KeysOfArrays<T> = { [K in keyof T]: T[K] extends readonly any[] ? K : never }[keyof T];
type ElementOf<T> = T extends readonly (infer U)[] ? U : never;

/* ------------------------------------------------------------------ *
 * Runtime
 * ------------------------------------------------------------------ */

const isReshaper = (value: unknown): value is Reshaper<any, any, any, any> =>
	typeof value === "object" && value !== null && (value as any)[BRAND] === true;

type Op =
	| { op: "pick"; keys: string[] }
	| { op: "omit"; keys: string[] }
	| { op: "rename"; mapping: Record<string, string> }
	| { op: "extend"; fields: Record<string, unknown> }
	| { op: "retype"; fns: Record<string, (value: any) => unknown> }
	| { op: "at"; key: string; apply: (value: any) => any; steps: Step[] }
	| { op: "each"; key: string; apply: (value: any) => any; steps: Step[] };

/** Apply one op to a working object we already own, so the whole pipeline
 *  costs a single shallow copy rather than one per step. */
const applyOp = (current: Record<string, any>, op: Op): Record<string, any> => {
	switch (op.op) {
		case "pick": {
			const next: Record<string, any> = {};
			for (const key of op.keys) if (key in current) next[key] = current[key];
			return next;
		}
		case "omit":
			for (const key of op.keys) delete current[key];
			return current;
		case "rename": {
			// Stage renamed values first so a swap (a->b, b->a) cannot clobber.
			const staged: Record<string, any> = {};
			for (const from of Object.keys(op.mapping)) {
				if (!(from in current)) continue;
				staged[op.mapping[from]!] = current[from];
				delete current[from];
			}
			return Object.assign(current, staged);
		}
		case "extend": {
			for (const key of Object.keys(op.fields)) {
				const spec = op.fields[key];
				current[key] = typeof spec === "function" ? (spec as (o: any) => unknown)(current) : spec;
			}
			return current;
		}
		case "retype": {
			for (const key of Object.keys(op.fns)) {
				if (key in current) current[key] = op.fns[key]!(current[key]);
			}
			return current;
		}
		case "at":
			if (op.key in current) current[op.key] = op.apply(current[op.key]);
			return current;
		case "each":
			if (Array.isArray(current[op.key])) current[op.key] = current[op.key].map(op.apply);
			return current;
	}
};

const toStep = (op: Op): Step => {
	switch (op.op) {
		case "extend": return {
			op: "extend",
			keys: Object.keys(op.fields),
			computed: Object.keys(op.fields).filter((k) => typeof op.fields[k] === "function"),
		};
		case "retype": return { op: "retype", keys: Object.keys(op.fns) };
		case "at": return { op: "at", key: op.key, steps: op.steps };
		case "each": return { op: "each", key: op.key, steps: op.steps };
		default: return op;
	}
};

/** Keys whose VALUE was transformed one-way, expressed in final output names. */
const transformedKeys = (ops: Op[]): Set<string> => {
	let keys = new Set<string>();
	for (const op of ops) {
		switch (op.op) {
			case "retype": for (const k of Object.keys(op.fns)) keys.add(k); break;
			case "at": case "each": keys.add(op.key); break;
			case "rename": {
				const moved = new Set<string>();
				for (const k of keys) moved.add(Object.prototype.hasOwnProperty.call(op.mapping, k) ? op.mapping[k]! : k);
				keys = moved;
				break;
			}
			case "pick": keys = new Set([...keys].filter((k) => op.keys.includes(k))); break;
			case "omit": for (const k of op.keys) keys.delete(k); break;
			case "extend": break;
		}
	}
	return keys;
};

const create = <In, Out, Src extends Provenance, NeedsFn extends PropertyKey>(
	ops: Op[]
): Reshaper<In, Out, Src, NeedsFn> => {
	const next = (op: Op): any => create([...ops, op]);

	const self: any = {
		[BRAND]: true,

		pick: (...keys: string[]) => next({ op: "pick", keys }),
		omit: (...keys: string[]) => next({ op: "omit", keys }),
		rename: (mapping: Record<string, string>) => next({ op: "rename", mapping }),

		extend: (fields: Record<string, unknown>) => next({ op: "extend", fields }),
		retype: (fns: Record<string, (value: any) => unknown>) => next({ op: "retype", fns }),

		at: (key: string, reshaper: any) => {
			const resolved = typeof reshaper === "function" && !isReshaper(reshaper)
				? reshaper(create([])) : reshaper;
			return next({
				op: "at", key,
				apply: isReshaper(resolved) ? resolved.build() : resolved,
				steps: isReshaper(resolved) ? resolved.explain() : [],
			});
		},

		each: (key: string, reshaper: any) => {
			const resolved = typeof reshaper === "function" && !isReshaper(reshaper)
				? reshaper(create([])) : reshaper;
			return next({
				op: "each", key,
				apply: isReshaper(resolved) ? resolved.build() : resolved,
				steps: isReshaper(resolved) ? resolved.explain() : [],
			});
		},

		build: () => (source: any) => {
			let current: Record<string, any> = { ...source };
			for (const op of ops) current = applyOp(current, op);
			return current;
		},

		run: (source: any) => self.build()(source),

		explain: () => ops.map(toStep),

		invert: (recipe: Record<string, (value: any) => unknown> = {}) => (input: any) => {
			let current: Record<string, any> = { ...input };

			// Which recipe entries are value-inverses (keyed by OUTPUT name) versus
			// reconstructors for dropped fields (keyed by SOURCE name). Presence in
			// the input cannot tell these apart -- a transformed key is simply absent
			// from a patch -- so classify them from the pipeline itself.
			const transformed = transformedKeys(ops);

			for (const key of Object.keys(recipe)) {
				if (transformed.has(key) && key in current) current[key] = recipe[key]!(current[key]);
			}

			for (let i = ops.length - 1; i >= 0; i--) {
				const op = ops[i]!;
				switch (op.op) {
					case "rename": {
						const staged: Record<string, any> = {};
						for (const from of Object.keys(op.mapping)) {
							const to = op.mapping[from]!;
							if (!(to in current)) continue;
							staged[from] = current[to];
							delete current[to];
						}
						Object.assign(current, staged);
						break;
					}
					case "extend":
						// Added fields have no source to map back to, so they are dropped.
						for (const key of Object.keys(op.fields)) delete current[key];
						break;
					default:
						break; // pick/omit are answered by reconstructors; retype/at/each by the recipe
				}
			}

			// Reconstruct dropped fields last, once keys carry their source names.
			// A reconstructor returning undefined contributes nothing, so a patch
			// never gains a key that would unset a column downstream.
			for (const key of Object.keys(recipe)) {
				if (transformed.has(key) || key in current) continue;
				const value = (recipe[key] as (o: any) => unknown)(input);
				if (value !== undefined) current[key] = value;
			}

			return current;
		},
	};

	return self;
};

/**
 * Start a pipeline.
 *
 * Name the source as a type parameter -- `reshape<User>()`, or
 * `reshape<typeof value>()` to infer from a value. Chain operations, then call
 * {@link Reshaper.build} for a reusable transform function, or
 * {@link Reshaper.run} to apply it once.
 *
 * @example
 * const toPublicUser = reshape<User>()
 *   .pick("authId", "name")
 *   .rename({ authId: "id" })
 *   .build();
 *
 * type PublicUser = ReturnType<typeof toPublicUser>;
 */
export function reshape<T extends object>(): Reshaper<T> {
	return create<T, T, { [K in keyof T]: K }, never>([]);
}
