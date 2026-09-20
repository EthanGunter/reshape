/**
 * Runtime benchmarks.
 *
 * The question this file exists to answer: what does a compiled mapper cost
 * compared to the transform you would have written by hand? Everything else
 * here -- per-op cost, scaling by depth and width, `invert` -- is there to
 * explain the answer when it stops being good.
 *
 *   node bench/runtime.bench.mjs
 *   node bench/runtime.bench.mjs --filter invert
 *
 * Benchmarks import from `dist/`, like the tests do, so run `npm run build`
 * first. `npm run bench` does both.
 */
import { run, bench, group, summary, do_not_optimize } from "mitata";
import { reshape } from "../dist/index.js";

/* ------------------------------- fixtures ------------------------------- */

const row = {
	_id: "row_1",
	_creationTime: 1700000000000,
	authId: "auth_9",
	name: "Ada",
	email: "ada@example.com",
	passwordHash: "$2b$xxx",
};

/**
 * An object with `n` keys, for measuring how cost scales with width.
 *
 * Built with `fromEntries` on purpose. Assigning `n` keys in a loop instead
 * looks equivalent and is not: past about twenty keys it leaves the object in
 * V8's dictionary mode, where spreading 100 keys costs ~17µs instead of
 * ~160ns. Objects real callers pass -- `JSON.parse` of a response body, an
 * object literal, a row from a driver -- are all in the fast bucket, so a
 * loop-built fixture would report a 100x pathology that no user can hit.
 * `bench/fixture-shapes.bench.mjs` pins this so it cannot quietly come back.
 */
const wide = (n) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`k${i}`, i]));

/** `count` nested rows, for measuring `each`. */
const withItems = (count) => ({
	id: "order_1",
	items: Array.from({ length: count }, (_, i) => ({
		sku: `sku_${i}`,
		qty: i,
		costCents: i * 100,
		_internalMargin: 0.3,
	})),
});

/* --------------------------- the headline case --------------------------- */

/*
 * A realistic mapper -- drop secrets, rename storage keys, revive a date,
 * derive a field -- against the same transform written by hand. The hand
 * written version is the floor: it allocates one object and reads each field
 * once. The gap between the two is what the library costs you.
 */

const byHand = (u) => ({
	id: u.authId,
	createdAt: new Date(u._creationTime),
	name: u.name,
	email: u.email,
	displayName: `${u.name} <${u.email}>`,
});

const compiled = reshape()
	.pick("authId", "_creationTime", "name", "email")
	.rename({ authId: "id", _creationTime: "createdAt" })
	.retype({ createdAt: (t) => new Date(t) })
	.extend({ displayName: (u) => `${u.name} <${u.email}>` })
	.build();

group("overhead vs a hand-written transform", () => {
	summary(() => {
		bench("hand-written", () => do_not_optimize(byHand(row)));
		bench("reshape .build()", () => do_not_optimize(compiled(row)));
		bench("reshape .run()", () =>
			do_not_optimize(
				reshape()
					.pick("authId", "_creationTime", "name", "email")
					.rename({ authId: "id", _creationTime: "createdAt" })
					.retype({ createdAt: (t) => new Date(t) })
					.extend({ displayName: (u) => `${u.name} <${u.email}>` })
					.run(row),
			));
	});
});

/*
 * `.build()` once and reuse, versus rebuilding per call. `.run()` above pays
 * for constructing the pipeline too; this isolates just the compile step, so
 * the two together say whether `.build()` is worth hoisting out of a loop.
 */
const pipeline = reshape()
	.pick("authId", "_creationTime", "name", "email")
	.rename({ authId: "id", _creationTime: "createdAt" })
	.retype({ createdAt: (t) => new Date(t) });

const prebuilt = pipeline.build();

group("build once vs build per call", () => {
	summary(() => {
		bench("reuse a built mapper", () => do_not_optimize(prebuilt(row)));
		bench("call .build() each time", () => do_not_optimize(pipeline.build()(row)));
	});
});

/* ------------------------------ per-op cost ------------------------------ */

/*
 * Each op alone, over the same six-key source, so they can be compared to one
 * another. `pick` constructs its result; `omit` and `rename` reach for
 * `delete`, which is the expensive primitive in this list.
 */
const ops = {
	"pick (3 of 6)": reshape().pick("name", "email", "authId").build(),
	"omit (3 of 6)": reshape().omit("passwordHash", "_id", "_creationTime").build(),
	"rename (2 keys)": reshape().rename({ authId: "id", _creationTime: "createdAt" }).build(),
	"rename (swap)": reshape().rename({ name: "email", email: "name" }).build(),
	"retype (1 key)": reshape().retype({ _creationTime: (t) => t + 1 }).build(),
	"extend (1 static)": reshape().extend({ source: "api" }).build(),
	"extend (1 computed)": reshape().extend({ label: (u) => u.name }).build(),
	"spread only (no ops)": reshape().build(),
};

group("cost of a single op", () => {
	summary(() => {
		for (const [name, fn] of Object.entries(ops)) {
			bench(name, () => do_not_optimize(fn(row)));
		}
	});
});

/* ---------------------------- the delete cost ---------------------------- */

/*
 * Why `omit` and `rename` cost what they do.
 *
 * `applyOp` mutates a working object it owns, which saves a copy per step --
 * but `omit` and `rename` do it with `delete`, and a deleted key drops the
 * object into V8's dictionary mode. The object stays slow for the rest of the
 * pipeline, so the penalty is paid again by every op that follows.
 *
 * These are raw objects, not pipelines, so the numbers isolate the primitive
 * rather than the library. Compare the last two rows: constructing the result
 * without the key is far cheaper than deleting it, which is the same trade
 * `.strict()` on the roadmap would make for `omit`.
 */
const sixKeys = () => ({ a: 1, b: 2, c: 3, d: 4, e: 5, f: 6 });

const copyOnly = () => ({ ...sixKeys() });
const deleteOne = () => { const o = { ...sixKeys() }; delete o.f; return o; };
const deleteThree = () => { const o = { ...sixKeys() }; delete o.d; delete o.e; delete o.f; return o; };
const deleteThenCopy = () => { const o = { ...sixKeys() }; delete o.f; return { ...o }; };
const constructWithout = () => { const s = sixKeys(); return { a: s.a, b: s.b, c: s.c, d: s.d, e: s.e }; };

group("the cost of `delete` on a working object", () => {
	summary(() => {
		bench("copy, no delete", () => do_not_optimize(copyOnly()));
		bench("copy, delete 1 key", () => do_not_optimize(deleteOne()));
		bench("copy, delete 3 keys", () => do_not_optimize(deleteThree()));
		bench("copy, delete 1, copy again (a later op)", () => do_not_optimize(deleteThenCopy()));
		bench("construct without the key", () => do_not_optimize(constructWithout()));
	});
});

/* ------------------------------- scaling -------------------------------- */

/*
 * Pipeline depth. Every op is a `retype` on a different key, so the shape of
 * the working object never changes and the only variable is the number of
 * steps the loop in `build()` walks.
 */
const keys = Object.keys(row);
const depths = [1, 2, 4, 8, 16];
const byDepth = new Map(
	depths.map((depth) => {
		let p = reshape();
		for (let i = 0; i < depth; i++) {
			const key = keys[i % keys.length];
			p = p.retype({ [key]: (v) => v });
		}
		return [depth, p.build()];
	}),
);

group("scaling: pipeline depth", () => {
	bench("$depth ops", function* (state) {
		const fn = byDepth.get(state.get("depth"));
		yield () => do_not_optimize(fn(row));
	}).args("depth", depths);
});

/*
 * Object width. `build()` opens with `{ ...source }`, so every pipeline pays
 * for the whole source object even when it keeps three keys. This is the
 * benchmark to watch if `.strict()` on the roadmap ever changes how results
 * are constructed.
 */
/*
 * Capped at 100 on purpose. Somewhere between ~130 and ~150 keys V8 moves an
 * object into dictionary mode, and past that point the spread dominates
 * everything Reshape does -- a 400-key row measured anywhere from 833ns to
 * 28µs for the same fixture, depending only on what ran before it. Those rows
 * measure the engine, not this library, and they are too unstable to regress
 * against. `bench/fixture-shapes.bench.mjs` locates the cliff deliberately.
 */
const widths = [5, 25, 100];
const wideRows = new Map(widths.map((n) => [n, wide(n)]));
const pick3 = reshape().pick("k0", "k1", "k2").build();

group("scaling: source width, keeping 3 keys", () => {
	bench("pick 3 of $width", function* (state) {
		const source = wideRows.get(state.get("width"));
		yield () => do_not_optimize(pick3(source));
	}).args("width", widths);
});

/*
 * The same reduction written as a denylist. `pick` builds a three-key object;
 * `omit` copies all `n` keys and then deletes `n - 3` of them, which also
 * pushes the object out of V8's fast path. The divergence is the point.
 */
const omitters = new Map(
	widths.map((n) => {
		const drop = Object.keys(wide(n)).slice(3);
		return [n, reshape().omit(...drop).build()];
	}),
);

group("scaling: pick vs omit for the same result", () => {
	summary(() => {
		bench("pick 3 of $width", function* (state) {
			const n = state.get("width");
			const source = wideRows.get(n);
			yield () => do_not_optimize(pick3(source));
		}).args("width", widths);

		bench("omit $width-3 of $width", function* (state) {
			const n = state.get("width");
			const source = wideRows.get(n);
			const fn = omitters.get(n);
			yield () => do_not_optimize(fn(source));
		}).args("width", widths);
	});
});

/*
 * `each` over a nested array. The per-element mapper is a compiled pipeline of
 * its own, so this is where a mapper applied to a large payload spends its
 * time. Compared against the same work as a plain `.map()`.
 */
const counts = [10, 100, 1000];
const orders = new Map(counts.map((n) => [n, withItems(n)]));

const eachMapper = reshape()
	.each("items", (item) => item.omit("_internalMargin").rename({ costCents: "cost" }))
	.build();

const eachByHand = (order) => ({
	id: order.id,
	items: order.items.map((i) => ({ sku: i.sku, qty: i.qty, cost: i.costCents })),
});

group("scaling: each over a nested array", () => {
	summary(() => {
		bench("reshape .each, $count items", function* (state) {
			const order = orders.get(state.get("count"));
			yield () => do_not_optimize(eachMapper(order));
		}).args("count", counts);

		bench("hand-written .map, $count items", function* (state) {
			const order = orders.get(state.get("count"));
			yield () => do_not_optimize(eachByHand(order));
		}).args("count", counts);
	});
});

/* -------------------------------- invert -------------------------------- */

/*
 * `invert()` returns a function, but unlike `build()` it does no work up
 * front: the returned closure recomputes `transformedKeys(ops)` -- a walk of
 * the whole pipeline, allocating Sets -- on every single call. These two
 * groups measure that. If the inverse is much slower than the forward mapper,
 * or if its cost grows with pipeline depth while the forward one stays flat,
 * that is the reason.
 */
const roundTrip = reshape()
	.pick("authId", "_creationTime", "name", "email")
	.rename({ authId: "id", _creationTime: "createdAt" })
	.retype({ createdAt: (t) => new Date(t) });

const forward = roundTrip.build();
const patchInverse = roundTrip.invert({ createdAt: (d) => d.getTime() });
const totalInverse = roundTrip.invert({
	createdAt: (d) => d.getTime(),
	_id: () => "row_1",
	passwordHash: () => "$2b$xxx",
});

const output = forward(row);

group("invert vs the forward mapper", () => {
	summary(() => {
		bench("forward .build()", () => do_not_optimize(forward(row)));
		bench("patch inverse", () => do_not_optimize(patchInverse(output)));
		bench("total inverse", () => do_not_optimize(totalInverse(output)));
	});
});

const inverseByDepth = new Map(
	depths.map((depth) => {
		let p = reshape();
		for (let i = 0; i < depth; i++) {
			const key = keys[i % keys.length];
			p = p.retype({ [key]: (v) => v });
		}
		return [depth, { forward: p.build(), inverse: p.invert(Object.fromEntries(keys.map((k) => [k, (v) => v]))) }];
	}),
);

group("scaling: does inverting stay flat with depth?", () => {
	bench("forward, $depth ops", function* (state) {
		const { forward } = inverseByDepth.get(state.get("depth"));
		yield () => do_not_optimize(forward(row));
	}).args("depth", depths);

	bench("inverse, $depth ops", function* (state) {
		const { inverse } = inverseByDepth.get(state.get("depth"));
		yield () => do_not_optimize(inverse(row));
	}).args("depth", depths);
});

await run({ filter: process.argv.includes("--filter") ? new RegExp(process.argv[process.argv.indexOf("--filter") + 1]) : undefined });
