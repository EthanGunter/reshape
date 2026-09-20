import { test } from "node:test";
import assert from "node:assert/strict";
import { reshape } from "../dist/index.js";

type Row = {
	_id: string;
	_creationTime: number;
	authId: string;
	name: string;
	email: string;
	passwordHash: string;
};

const row = (): Row => ({
	_id: "row_1",
	_creationTime: 1700000000000,
	authId: "auth_9",
	name: "Ada",
	email: "ada@example.com",
	passwordHash: "$2b$xxx",
});

/* ------------------------------ structure ------------------------------ */

test("pick builds the result from an allowlist, so untyped runtime fields cannot leak", () => {
	// The row carries fields that are not in `Row` at all -- a migration added
	// them and nobody regenerated the types.
	const drifted = { ...row(), ssn: "078-05-1120", internalRiskScore: 0.93 };
	const out = reshape<Row>().pick("name", "email").build()(drifted);

	assert.deepEqual(out, { name: "Ada", email: "ada@example.com" });
	assert.deepEqual(Object.keys(out).sort(), ["email", "name"]);
});

test("omit is a denylist and passes untyped runtime fields through (documented limitation)", () => {
	const drifted = { ...row(), ssn: "078-05-1120" };
	const out: Record<string, unknown> = reshape<Row>().omit("passwordHash").build()(drifted) as never;

	// Pinned deliberately: this is why the README warns about `omit` at a
	// trust boundary. If this ever changes, the docs must change with it.
	assert.equal(out.ssn, "078-05-1120");
	assert.equal("passwordHash" in out, false);
});

test("the source object is never mutated", () => {
	const source = row();
	const snapshot = structuredClone(source);
	reshape<Row>().omit("passwordHash").rename({ authId: "id" }).build()(source);
	assert.deepEqual(source, snapshot);
});

test("rename handles a straight swap without clobbering", () => {
	const out = reshape<{ a: string; b: string }>()
		.rename({ a: "b", b: "a" })
		.build()({ a: "A", b: "B" });
	assert.deepEqual(out, { a: "B", b: "A" });
});

/* ------------------------------- values -------------------------------- */

test("extend takes statics, computed fields, and a function stored as a value", () => {
	const noop = () => "hi";
	const out = reshape<{ first: string; last: string }>()
		.extend({
			source: "api" as const,
			fullName: (u) => `${u.first} ${u.last}`,
			handler: () => noop,
		})
		.build()({ first: "Ada", last: "Lovelace" });

	assert.equal(out.source, "api");
	assert.equal(out.fullName, "Ada Lovelace");
	assert.equal(out.handler, noop);
});

test("computed fields see the shape as of that step, not the original", () => {
	const out = reshape<{ a: number }>()
		.retype({ a: (n) => n * 2 })
		.extend({ doubled: (o) => o.a })
		.build()({ a: 5 });
	assert.equal(out.doubled, 10);
});

test("retype transforms only the keys it names", () => {
	const out = reshape<Row>()
		.retype({ _creationTime: (t) => new Date(t) })
		.build()(row());
	assert.ok(out._creationTime instanceof Date);
	assert.equal(out.name, "Ada");
});

/* ------------------------------- nesting ------------------------------- */

test("at accepts an inline callback and a standalone reshaper", () => {
	type User = { name: string; profile: { bio: string; internal_score: number } };
	const source: User = { name: "Ada", profile: { bio: "hi", internal_score: 9 } };

	const inline = reshape<User>().at("profile", (r) => r.pick("bio")).build()(source);
	assert.deepEqual(inline, { name: "Ada", profile: { bio: "hi" } });

	const publicProfile = reshape<User["profile"]>().pick("bio");
	const composed = reshape<User>().at("profile", publicProfile).build()(source);
	assert.deepEqual(composed, { name: "Ada", profile: { bio: "hi" } });
});

test("each reshapes every element of an array", () => {
	const out = reshape<{ posts: { id: string; title: string; draft: string }[] }>()
		.each("posts", (r) => r.pick("id", "title"))
		.build()({ posts: [{ id: "1", title: "A", draft: "x" }, { id: "2", title: "B", draft: "y" }] });
	assert.deepEqual(out, { posts: [{ id: "1", title: "A" }, { id: "2", title: "B" }] });
});

/* -------------------------------- misc --------------------------------- */

test("run applies the pipeline once, and the function is reusable across a list", () => {
	const toPublic = reshape<Row>().pick("name", "email").build();
	assert.deepEqual([row(), row()].map(toPublic).length, 2);
	assert.deepEqual(reshape<Row>().pick("name").run(row()), { name: "Ada" });
});

test("explain reports the compiled plan as data", () => {
	const plan = reshape<Row>()
		.omit("passwordHash")
		.rename({ authId: "id" })
		.extend({ source: "api" as const, label: (o) => o.name })
		.explain();

	assert.deepEqual(plan, [
		{ op: "omit", keys: ["passwordHash"] },
		{ op: "rename", mapping: { authId: "id" } },
		{ op: "extend", keys: ["source", "label"], computed: ["label"] },
	]);
});
