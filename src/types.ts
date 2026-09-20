/** Collapse intersections and mapped types into a flat, readable shape. */
export type Simplify<T> =
	T extends (...args: any[]) => any ? T :
	T extends Date | RegExp | Error ? T :
	T extends readonly (infer _U)[] ? { -readonly [K in keyof T]: Simplify<T[K]> } :
	T extends object ? { -readonly [K in keyof T]: Simplify<T[K]> } :
	T;

/**
 * Every transform distributes over unions, so a discriminated union stays
 * discriminable after reshaping. `keyof (A | B)` is only the SHARED keys, so
 * member-specific fields still require branching first.
 */
export type DistributivePick<T, K extends PropertyKey> =
	T extends any ? Simplify<Pick<T, Extract<K, keyof T>>> : never;

export type DistributiveOmit<T, K extends PropertyKey> =
	T extends any ? Simplify<Omit<T, K>> : never;

export type RenameKeys<T, M> = T extends any
	? Simplify<
		Omit<T, keyof M> & {
			[Old in keyof M as M[Old] extends string ? M[Old] : never]: Old extends keyof T ? T[Old] : never;
		}
	>
	: never;

export type Retype<T, F> = T extends any
	? Simplify<
		Omit<T, keyof F> & { [K in keyof F]-?: F[K] extends (value: any) => infer R ? R : never }
	>
	: never;

/**
 * A field value is either a static, or a function of the whole current shape.
 * Naming the function form in the CONSTRAINT is what gives the callback
 * parameter a contextual type; `Record<string, unknown>` does not.
 */
export type FieldSpec<Out> =
	| ((current: Out) => unknown)
	| string | number | boolean | bigint | null | undefined
	| readonly unknown[] | Record<string, unknown> | Date;

export type Extended<Out, U> = {
	[K in keyof U]: U[K] extends (current: Out) => infer R ? R : U[K];
};
