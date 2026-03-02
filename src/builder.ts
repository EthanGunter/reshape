import type { Simplify } from "./simplifyType";
import type { RenameKeys, Retype, RetypeMapFromFns } from "./transforms";

type DTOBuilder<T extends object> = {
	omit<K extends keyof T>(...keys: K[]): DTOBuilder<Omit<T, K>>;
	pick<K extends keyof T>(...keys: K[]): DTOBuilder<Pick<T, K>>;
	extend<U extends object>(fields: U): DTOBuilder<Simplify<T & U>>;
	rename<const M extends Partial<Record<keyof T, string>>>(
		mapping: M
	): DTOBuilder<Simplify<RenameKeys<T, M>>>;
	retype<
		const F extends Partial<{ [K in keyof T]: (value: T[K]) => unknown }>
	>(mapping: F): DTOBuilder<Retype<T, RetypeMapFromFns<T, F>>>;
	done(): Simplify<T>;
};

function createBuilder<T extends object>(obj: T): DTOBuilder<T> {
	return {
		omit<K extends keyof T>(...keys: K[]): DTOBuilder<Omit<T, K>> {
			const next = { ...obj };
			for (const k of keys) delete (next as any)[k];
			return createBuilder(next as Omit<T, K>);
		},

		pick<K extends keyof T>(...keys: K[]): DTOBuilder<Pick<T, K>> {
			const next = {} as Pick<T, K>;
			for (const k of keys) next[k] = obj[k];
			return createBuilder(next);
		},

		extend<U extends object>(fields: U): DTOBuilder<Simplify<T & U>> {
			return createBuilder({ ...obj, ...fields } as Simplify<T & U>);
		},

		rename<const M extends Partial<Record<keyof T, string>>>(
			mapping: M
		): DTOBuilder<Simplify<RenameKeys<T, M>>> {
			const next: any = { ...obj };

			for (const oldKey in mapping) {
				if (!Object.prototype.hasOwnProperty.call(mapping, oldKey)) continue;

				const newKey = mapping[oldKey as keyof M];
				if (typeof newKey !== "string") continue;

				next[newKey] = (obj as any)[oldKey];
				delete next[oldKey];
			}

			return createBuilder(next as Simplify<RenameKeys<T, M>>);
		},

		retype<
			const F extends Partial<{ [K in keyof T]: (value: T[K]) => unknown }>
		>(mapping: F): DTOBuilder<Retype<T, RetypeMapFromFns<T, F>>> {
			const next: any = { ...obj };

			for (const k in mapping) {
				if (!Object.prototype.hasOwnProperty.call(mapping, k)) continue;

				const fn = (mapping as any)[k];
				if (typeof fn !== "function") continue;

				next[k] = fn((obj as any)[k]);
			}

			return createBuilder(next as Retype<T, RetypeMapFromFns<T, F>>);
		},

		done(): Simplify<T> {
			return obj as unknown as Simplify<T>;
		},
	};
}

export function reshape<T extends object>(source: T): DTOBuilder<T> {
	return createBuilder(source);
}

export type { DTOBuilder };
