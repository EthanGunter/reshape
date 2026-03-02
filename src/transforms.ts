import type { Simplify } from "./simplifyType";

export type RenameKeys<T, Mapping extends Partial<Record<keyof T, string>>> = Omit<
	T,
	keyof Mapping
> & {
	[OldKey in keyof Mapping as Mapping[OldKey] extends string
	? Mapping[OldKey]
	: never]: OldKey extends keyof T ? T[OldKey] : never;
};

export type Retype<
	T extends object,
	R extends Partial<Record<keyof T, unknown>>
> = Simplify<Omit<T, keyof R> & R>;

export type RetypeMapFromFns<
	T extends object,
	F extends Partial<{ [K in keyof T]: (value: T[K]) => unknown }>
> = {
	[K in keyof F]-?: F[K] extends (value: any) => infer R ? R : never;
};
