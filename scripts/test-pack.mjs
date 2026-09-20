/**
 * Test the package, not the source.
 *
 * Everything else in `npm test` compiles this repo against itself, where
 * every file is reachable by relative path. A consumer sees only the tarball,
 * resolved through the `exports` map -- and the gap between those two is
 * invisible here and total for them.
 *
 * The bug that prompted this: `build()` returns `Built`, which was reachable
 * only at `dist/reshape.js`, a deep path `exports` does not expose. Any
 * package re-exporting a mapper failed to emit declarations at all:
 *
 *   error TS2883: The inferred type of 'toPublic' cannot be named without a
 *   reference to '.../dist/reshape.js'.
 *
 * The full suite was green. So: pack it, install it somewhere else, and check
 * that a real consumer can typecheck, emit declarations and run.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

const dir = mkdtempSync(join(tmpdir(), "reshape-pack-"));
let failures = 0;
const check = (label, fn) => {
	try {
		fn();
		console.log(`  ok    ${label}`);
	} catch (err) {
		failures++;
		console.error(`  FAIL  ${label}\n${(err.stdout || err.message || "").toString().trim().split("\n").map((l) => `        ${l}`).join("\n")}`);
	}
};

console.log("packaging test");
try {
	run("npm", ["pack", "--pack-destination", dir], root);
	const tarball = join(dir, readdirSync(dir).find((f) => f.endsWith(".tgz")));

	writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "consumer", type: "module", version: "1.0.0" }));
	// A library that re-exports a mapper: the case that emits the library's own
	// types into someone else's declaration output.
	writeFileSync(join(dir, "lib.ts"), `
import { reshape } from "@ethangunter/reshape";
type Row = { _id: string; authId: string; name: string; secret: string; addr: { city: string; _internal: number } };
const addr = reshape<Row["addr"]>().omit("_internal").build();
export const toPublic = reshape<Row>().omit("secret", "_id").rename({ authId: "id" }).at("addr", addr).build();
export type Public = ReturnType<typeof toPublic>;
`);
	writeFileSync(join(dir, "smoke.mjs"), `
import { reshape } from "@ethangunter/reshape";
import assert from "node:assert/strict";
const row = { _id: "1", authId: "a9", name: "Ada", secret: "x" };
const fwd = reshape().omit("secret", "_id").rename({ authId: "id" }).build();
assert.deepEqual(fwd(row), { id: "a9", name: "Ada" });
assert.deepEqual(Object.keys(fwd(row)), ["id", "name"], "renamed key should keep its position");
const back = reshape().omit("secret", "_id").rename({ authId: "id" }).invert({ _id: () => "1", secret: () => "x" });
assert.deepEqual(back(fwd(row)), { authId: "a9", name: "Ada", _id: "1", secret: "x" });
const nested = reshape().omit("_internal").build();
assert.deepEqual(reshape().at("addr", nested).build()({ addr: { city: "X", _internal: 9 } }), { addr: { city: "X" } });
`);

	// Only the tarball is installed; `tsc` comes from this repo, so CI does not
	// need a second network fetch to typecheck the consumer.
	run("npm", ["install", "--silent", "--no-audit", "--no-fund", tarball], dir);

	// Declaration emit under both resolution modes a consumer is likely to use.
	for (const [label, opts] of [
		["nodenext", { module: "NodeNext", moduleResolution: "nodenext" }],
		["bundler", { module: "ESNext", moduleResolution: "bundler" }],
	]) {
		const config = join(dir, `tsconfig.${label}.json`);
		writeFileSync(config, JSON.stringify({
			compilerOptions: { strict: true, target: "ES2022", declaration: true, outDir: `out-${label}`, skipLibCheck: true, ...opts },
			files: ["lib.ts"],
		}));
		check(`consumer typechecks and emits declarations (${label})`, () => {
			run(join(root, "node_modules", ".bin", "tsc"), ["-p", config], dir);
			const emitted = readFileSync(join(dir, `out-${label}`, "lib.d.ts"), "utf8");
			// It may legitimately name the library's types -- but only through
			// the entry point the exports map actually exposes.
			const deep = emitted.match(/import\("@ethangunter\/reshape\/[^"]+"\)/g);
			if (deep) throw new Error(`declaration reaches past the exports map: ${deep.join(", ")}`);
		});
	}

	check("installed package runs", () => run(process.execPath, [join(dir, "smoke.mjs")], dir));
} finally {
	rmSync(dir, { recursive: true, force: true });
}

if (failures) {
	console.error(`\n${failures} packaging check(s) failed.`);
	process.exit(1);
}
console.log("  all packaging checks passed");
