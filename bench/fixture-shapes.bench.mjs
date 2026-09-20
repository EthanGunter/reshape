/**
 * A guard on the benchmarks themselves, not on the library.
 *
 * Every pipeline opens with `{ ...source }`, so the spread is the floor under
 * every number in `runtime.bench.mjs`. That floor moves by a factor of ~100
 * depending on nothing but how the source object was *constructed*, because
 * assigning many keys in a loop leaves the object in V8's dictionary mode
 * while a literal, `JSON.parse` and `Object.fromEntries` do not.
 *
 * The trap: build a width fixture with a `for` loop -- the obvious way -- and
 * `runtime.bench.mjs` reports that Reshape takes 17µs to pick three keys from
 * a hundred. It does not. The fixture was pathological, and no caller passing
 * a parsed response body or an object literal can reproduce it.
 *
 * Run this when a width number looks alarming, before believing it.
 *
 *   node bench/fixture-shapes.bench.mjs
 */
import { run, bench, group, summary, do_not_optimize } from "mitata";

const N = 100;

const byLoop = (() => {
	const o = {};
	for (let i = 0; i < N; i++) o[`k${i}`] = i;
	return o;
})();

const byFromEntries = Object.fromEntries(Array.from({ length: N }, (_, i) => [`k${i}`, i]));
const byJson = JSON.parse(JSON.stringify(byLoop));
const byLiteral = new Function(`return {${Array.from({ length: N }, (_, i) => `k${i}:${i}`).join(",")}}`)();

group(`spreading a ${N}-key object, by how it was built`, () => {
	summary(() => {
		bench("object literal", () => do_not_optimize({ ...byLiteral }));
		bench("JSON.parse", () => do_not_optimize({ ...byJson }));
		bench("Object.fromEntries", () => do_not_optimize({ ...byFromEntries }));
		bench("keys assigned in a loop", () => do_not_optimize({ ...byLoop }));
	});
});

/*
 * The other half of the same effect: key *count*. Even an object built the
 * fast way falls off a cliff once V8 stops giving it fast properties, which
 * lands between 129 and 150 keys.
 *
 * This is why `runtime.bench.mjs` caps its width sweep at 100. Past the cliff
 * the spread dwarfs everything Reshape does, and the numbers stop being
 * reproducible -- the same 400-key fixture has measured 833ns and 28µs in the
 * same session, depending only on what ran before it. Nothing above the cliff
 * belongs in a regression suite.
 */
const widths = [64, 100, 128, 129, 150, 200, 400];
const sources = new Map(widths.map((n) => [n, Object.fromEntries(Array.from({ length: n }, (_, i) => [`k${i}`, i]))]));

group("spreading by key count: where the cliff is", () => {
	bench("$width keys", function* (state) {
		const src = sources.get(state.get("width"));
		yield () => do_not_optimize({ ...src });
	}).args("width", widths);
});

await run();
