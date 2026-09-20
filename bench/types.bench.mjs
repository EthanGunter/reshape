/**
 * Type-checking benchmarks.
 *
 * Reshape's whole premise is that the types come along for free, so the cost
 * that actually reaches a user is the one their editor pays on every
 * keystroke. This measures it: generate a fixture per scenario, check each one
 * with `tsc --extendedDiagnostics`, and report what it cost.
 *
 * Read the **Instantiations** column, not the time. Instantiation count is
 * deterministic -- the same fixture yields the same number on any machine --
 * while check time on the native compiler is tens of milliseconds and mostly
 * noise. Time is reported anyway, as a sanity check that the two agree.
 *
 * Fixtures import from `dist/`, not `src/`, so what is measured is the
 * declaration file a consumer actually installs.
 *
 *   npm run build && node bench/types.bench.mjs
 *   node bench/types.bench.mjs --filter invert
 *   node bench/types.bench.mjs --json          # for CI / regression ceilings
 *   node bench/types.bench.mjs --trace depth-16
 *
 * `--trace <scenario>` writes a `--generateTrace` profile and prints where it
 * landed; open it with `npx @typescript/analyze-trace <dir>` to find which
 * type is doing the work.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const tsc = join(root, "node_modules", ".bin", "tsc");

const argv = process.argv.slice(2);
const flag = (name) => {
	const i = argv.indexOf(name);
	return i === -1 ? undefined : argv[i + 1];
};
const filter = flag("--filter");
const traceOnly = flag("--trace");
const asJson = argv.includes("--json");
const SAMPLES = Number(flag("--samples") ?? 3);

/* ------------------------------- fixtures ------------------------------- */

/** A source type with `n` keys. */
const rowType = (n) =>
	`type Row = {\n${Array.from({ length: n }, (_, i) => `\t k${i}: ${i % 3 === 0 ? "string" : i % 3 === 1 ? "number" : "boolean"};`).join("\n")}\n};`;

/**
 * Wraps a pipeline expression in the scaffolding that forces TypeScript to
 * actually compute the output type. Without the mapped type at the end, the
 * checker is lazy enough to leave most of the work undone and every scenario
 * reports the same number.
 */
const fixture = (decls, expr) => `
import { reshape } from "IMPORT_PATH";

${decls}

declare const src: Row;
const fn = ${expr};
const out = fn(src);

// Forces full resolution of the output type -- a bare \`typeof out\` does not.
export type Out = { [K in keyof typeof out]-?: (typeof out)[K] };
export const keys: string[] = Object.keys(out);
`;

const chain = (n) => {
	const keys = ["k0", "k1", "k2", "k3", "k4"];
	let out = "reshape<Row>()";
	for (let i = 0; i < n; i++) out += `\n\t.retype({ ${keys[i % keys.length]}: (v) => [v] as const })`;
	return `${out}\n\t.build()`;
};

const scenarios = [
	/* The floor: importing the library and naming nothing. Everything below is
	   only meaningful as a delta over this. */
	{
		name: "baseline (import only)",
		group: "floor",
		source: `
import { reshape } from "IMPORT_PATH";
${rowType(5)}
export const r = reshape<Row>();
`,
	},

	/* Chain length. The parameters of `Reshaper` are rebuilt at every link, so
	   this is the axis most likely to bite: a long pipeline is idiomatic. */
	...[1, 2, 4, 8, 16].map((n) => ({
		name: `depth-${n}`,
		group: "pipeline depth",
		source: fixture(rowType(5), chain(n)),
	})),

	/* Source width. `Src` is a mapped type over `keyof In`, and
	   `DistributivePick`/`DistributiveOmit` walk the key set too, so a wide
	   source type multiplies work that a narrow one hides. */
	...[5, 25, 100].map((n) => ({
		name: `width-${n}`,
		group: "source width",
		source: fixture(rowType(n), `reshape<Row>()\n\t.pick("k0", "k1", "k2")\n\t.build()`),
	})),

	/* One op at a time, priced against each other.

	   Every fixture in this group shares one source type -- the nested `at`
	   and `each` fields included -- so the rows differ by the operator and
	   nothing else. Giving only `at`/`each` the wider type would credit them
	   with cost that belongs to the extra fields. */
	...Object.entries({
		"none (control)": ``,
		pick: `.pick("k0", "k1", "k2")`,
		omit: `.omit("k3", "k4")`,
		rename: `.rename({ k0: "a", k1: "b" })`,
		extend: `.extend({ s: "x" as const, c: (o) => o.k1 })`,
		retype: `.retype({ k1: (v) => [v] as const })`,
		at: `.at("nested", (n) => n.pick("x").build())`,
		each: `.each("list", (e) => e.pick("x").build())`,
	}).map(([op, call]) => ({
		name: `op-${op}`,
		group: "per-operator",
		source: fixture(
			`${rowType(5).replace(/\n};$/, "")}\n\tnested: { x: string; y: number };\n\tlist: { x: string; y: number }[];\n};`,
			`reshape<Row>()${call ? `\n\t${call}` : ""}\n\t.build()`,
		),
	})),

	/* Nesting depth.

	   `at` and `each` are by far the most expensive operators, because their
	   signature takes `R | ((nested: Reshaper<Out[K]>) => R)`: inferring `R`
	   means instantiating a whole `Reshaper` for the nested type, every method
	   and every generic signature with it. What this group answers is whether
	   that cost *composes* -- an `at` inside an `at` inside an `at` is the
	   shape that would turn a 36x operator into an unusable one. */
	...[1, 2, 3].map((depth) => {
		/* A chain of nested object types, L1 wrapping L2 wrapping ... */
		const levels = Array.from({ length: depth }, (_, i) => i + 1);
		const decls = levels
			.map((l) => `type L${l} = ${l === depth ? `{ x: string; y: number }` : `{ x: string; n${l + 1}: L${l + 1} }`};`)
			.reverse()
			.join("\n");
		const nest = (l) =>
			l === depth
				? `(e) => e.pick("x").build()`
				: `(e) => e.at("n${l + 1}", ${nest(l + 1)}).build()`;
		return {
			name: `nested-at-${depth}`,
			group: "nesting depth",
			source: fixture(
				`${decls}\ntype Row = { k0: string; n1: L1 };`,
				`reshape<Row>()\n\t.at("n1", ${nest(1)})\n\t.build()`,
			),
		};
	}),

	/* Sibling `at` calls, as opposed to nested ones.

	   Nesting turns out to be nearly free after the first `at`, which suggests
	   the ~9k is a one-time cost for instantiating `Reshaper` over a nested
	   type at all. If that is right it should amortize here too, and a mapper
	   module with ten `at` calls costs about the same as one with a single
	   `at`. If instead it is per-callsite, this group multiplies and the advice
	   for users is the opposite. */
	...[1, 2, 5, 10].map((n) => ({
		name: `sibling-at-${n}`,
		group: "sibling at calls",
		source: `
import { reshape } from "IMPORT_PATH";

type Nested = { x: string; y: number };
type Row = { k0: string; ${Array.from({ length: n }, (_, i) => `n${i}: Nested`).join("; ")} };

declare const src: Row;
${Array.from({ length: n }, (_, i) =>
	`const f${i} = reshape<Row>().at("n${i}", (e) => e.pick("x").build()).build();
export const o${i} = f${i}(src);`).join("\n")}
`,
	})),

	/* `invert` carries the heaviest types in the library -- `Recipe`,
	   `NoExtraKeys`, `SuppliedKeys`, `InverseOf` -- and the overload picks
	   between them with a conditional on `NeedsFn`. Worth knowing whether
	   reaching for it doubles the bill. */
	/* Each row is paired with a control running the SAME pipeline and no
	   `.invert(...)`, so the difference between a pair is what inverting cost
	   and nothing else. `bare` needs its own pair because a pipeline with a
	   `retype` in it cannot call `.invert()` with no recipe -- the value
	   inverse is mandatory there, which is the point of the type. */
	...Object.entries({
		"bare: control": [`.pick("k0", "k1").rename({ k0: "a" })`, null],
		"bare: .invert()": [`.pick("k0", "k1").rename({ k0: "a" })`, ``],
		"recipe: control": [`.pick("k0", "k1").rename({ k0: "a" }).retype({ k1: (v) => [v] as const })`, null],
		"recipe: .invert({fn})": [
			`.pick("k0", "k1").rename({ k0: "a" }).retype({ k1: (v) => [v] as const })`,
			`{ k1: (v) => v[0] }`,
		],
		"total: .invert({fn, ...rebuild})": [
			`.pick("k0", "k1").rename({ k0: "a" }).retype({ k1: (v) => [v] as const })`,
			`{ k1: (v) => v[0], k2: () => true, k3: () => "x", k4: () => 1 }`,
		],
	}).map(([name, [ops, recipe]]) => ({
		name,
		group: "invert",
		/* An inverse consumes the OUTPUT shape, not `Row`, so it has to be fed
		   the forward mapper's result rather than the source. */
		source: `
import { reshape } from "IMPORT_PATH";

${rowType(5)}

declare const src: Row;
const p = reshape<Row>()${ops};
const shaped = p.build()(src);
const out = ${recipe === null ? "shaped" : `p.invert(${recipe})(shaped)`};

export type Out = { [K in keyof typeof out]-?: (typeof out)[K] };
export const keys: string[] = Object.keys(out);
`,
	})),

	/* Union sources. `DistributivePick` and `DistributiveOmit` distribute, so
	   a discriminated union -- the shape most likely to be reshaped at an API
	   boundary -- multiplies the per-member cost. Checking whether that
	   multiplication stays linear. */
	...[2, 4, 8].map((n) => ({
		name: `union-${n}`,
		group: "union source",
		source: fixture(
			`type Row =\n${Array.from({ length: n }, (_, i) => `\t| { kind: "v${i}"; k0: string; k1: number; k2: boolean; u${i}: string }`).join("\n")};`,
			`reshape<Row>()\n\t.omit("k2")\n\t.rename({ k0: "a" })\n\t.build()`,
		),
	})),

	/* Many small pipelines in one file, the way a real mapper module looks.
	   Confirms cost is linear in pipelines and that nothing is quadratic in
	   the number of distinct instantiations. */
	...[1, 10, 30].map((n) => ({
		name: `pipelines-${n}`,
		group: "many pipelines in one file",
		source: `
import { reshape } from "IMPORT_PATH";
${rowType(8)}
declare const src: Row;
${Array.from(
	{ length: n },
	(_, i) => `const f${i} = reshape<Row>().pick("k0", "k1", "k2").rename({ k0: "a${i}" }).build();
export const o${i} = f${i}(src);`,
).join("\n")}
`,
	})),
];

/* -------------------------------- runner -------------------------------- */

const dir = mkdtempSync(join(tmpdir(), "reshape-typebench-"));
const importPath = relative(dir, join(root, "dist", "index.js")).replaceAll("\\", "/");

const write = (scenario) => {
	const file = join(dir, `${scenario.name.replace(/[^a-z0-9-]/gi, "_")}.ts`);
	writeFileSync(file, scenario.source.replaceAll("IMPORT_PATH", importPath));
	return file;
};

const TSC_FLAGS = [
	"--noEmit",
	"--strict",
	"--target", "ES2020",
	"--module", "ESNext",
	"--moduleResolution", "bundler",
	"--skipLibCheck",
	// Fixtures live in a temp dir and are passed by path; without this, tsc
	// refuses to run because the repo's own tsconfig.json is in scope.
	"--ignoreConfig",
];

const parse = (stdout) => {
	const num = (label) => {
		const m = stdout.match(new RegExp(`^${label}:\\s+([\\d.]+)`, "m"));
		return m ? Number(m[1]) : undefined;
	};
	return {
		instantiations: num("Instantiations"),
		types: num("Types"),
		checkTime: num("Check time"),
		totalTime: num("Total time"),
		memory: num("Memory used"),
	};
};

/**
 * A fixture that does not compile is not measuring the thing it was written
 * to measure -- a type error can short-circuit the very instantiation being
 * priced. So errors are collected and reported rather than thrown, and the
 * numbers for that row are flagged.
 */
const check = (file, extra = []) => {
	let stdout;
	try {
		stdout = execFileSync(tsc, [...TSC_FLAGS, "--extendedDiagnostics", ...extra, file], { encoding: "utf8" });
	} catch (err) {
		stdout = err.stdout ?? "";
	}
	const errors = stdout.split("\n").filter((l) => /error TS\d+/.test(l));
	return { ...parse(stdout), errors };
};

/* --trace: one scenario, profiled, for finding which type is responsible. */
if (traceOnly) {
	const scenario = scenarios.find((s) => s.name === traceOnly);
	if (!scenario) {
		console.error(`No scenario named "${traceOnly}". Available:\n  ${scenarios.map((s) => s.name).join("\n  ")}`);
		process.exit(1);
	}
	const traceDir = join(dir, "trace");
	mkdirSync(traceDir, { recursive: true });
	check(write(scenario), ["--generateTrace", traceDir]);
	console.log(`Trace for "${scenario.name}" written to:\n  ${traceDir}\n`);
	console.log(`Analyze it with:\n  npx @typescript/analyze-trace ${traceDir}`);
	console.log(`Or open ${join(traceDir, "trace.json")} in https://ui.perfetto.dev`);
	process.exit(0);
}

/* The floor is always measured, filter or not: every other row is reported as
   a delta over it, and tsc's fixed startup dwarfs most of the deltas. */
const selected = scenarios.filter(
	(s) => s.group === "floor" || !filter || s.name.includes(filter) || s.group.includes(filter),
);

const results = [];
for (const scenario of selected) {
	const file = write(scenario);
	const samples = Array.from({ length: SAMPLES }, () => check(file));
	const sorted = [...samples].sort((a, b) => a.checkTime - b.checkTime);
	results.push({
		...scenario,
		...samples[0], // instantiations and types are deterministic
		checkTime: sorted[Math.floor(sorted.length / 2)].checkTime,
		totalTime: sorted[Math.floor(sorted.length / 2)].totalTime,
	});
}

rmSync(dir, { recursive: true, force: true });

if (asJson) {
	console.log(JSON.stringify(
		results.map(({ name, group, instantiations, types, checkTime, memory }) =>
			({ name, group, instantiations, types, checkTime, memory })),
		null, 2,
	));
	process.exit(0);
}

/* -------------------------------- report -------------------------------- */

const baseline = results.find((r) => r.group === "floor");
const n = (v) => v.toLocaleString("en-US");

console.log(`\ntsc ${execFileSync(tsc, ["--version"], { encoding: "utf8" }).trim()}  ·  median of ${SAMPLES} runs  ·  instantiations are exact\n`);

const rows = results.map((r) => ({
	name: r.name,
	inst: n(r.instantiations),
	over: baseline && r !== baseline ? `+${n(r.instantiations - baseline.instantiations)}` : "--",
	types: n(r.types),
	check: `${(r.checkTime * 1000).toFixed(0)}ms`,
	mem: `${Math.round(r.memory / 1024)}MB`,
	group: r.group,
	errors: r.errors,
}));

const w = (key, head) => Math.max(head.length, ...rows.map((r) => r[key].length));
const cols = [
	["name", "scenario", "padEnd"],
	["inst", "instantiations", "padStart"],
	["over", "over baseline", "padStart"],
	["types", "types", "padStart"],
	["check", "check", "padStart"],
	["mem", "memory", "padStart"],
];
const widths = Object.fromEntries(cols.map(([key, head]) => [key, w(key, head)]));
const line = (get) => cols.map(([key, head, pad]) => get(key, head)[pad](widths[key])).join("  ");

let current = null;
console.log(line((key, head) => head));
console.log(cols.map(([key]) => "-".repeat(widths[key])).join("  "));
for (const row of rows) {
	if (row.group !== current) {
		current = row.group;
		console.log(`\n\x1b[2m${current}\x1b[0m`);
	}
	console.log(line((key) => row[key]) + (row.errors.length ? "  \x1b[31m← did not compile\x1b[0m" : ""));
}
console.log();

const broken = rows.filter((r) => r.errors.length);
if (broken.length) {
	console.log(`\x1b[31m${broken.length} fixture(s) failed to compile; their numbers are not meaningful.\x1b[0m`);
	for (const r of broken) console.log(`\n  ${r.name}\n    ${r.errors.slice(0, 4).join("\n    ")}`);
	console.log();
	process.exitCode = 1;
}
