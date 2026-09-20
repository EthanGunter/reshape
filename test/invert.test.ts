import { test } from "node:test";
import assert from "node:assert/strict";
import { reshape } from "../dist/index.js";

/* Convex-shaped source: timestamps are ints on the way in, Dates on the way out. */
type Doc = { _id: string; _creationTime: number; authId: string; name: string; passwordHash: string };

test("a pure key remapping inverts with no recipe at all", () => {
	const pipeline = reshape<{ authId: string; name: string }>().rename({ authId: "id" });
	const back = pipeline.invert();
	assert.deepEqual(back({ id: "auth_9", name: "Ada" }), { authId: "auth_9", name: "Ada" });
});

test("a one-way retype inverts with the supplied reverse function", () => {
	const pipeline = reshape<{ authId: string; _creationTime: number }>()
		.rename({ authId: "id", _creationTime: "createdAt" })
		.retype({ createdAt: (t) => new Date(t) });

	const toDb = pipeline.invert({ createdAt: (d) => d.getTime() });
	assert.deepEqual(toDb({ id: "auth_9", createdAt: new Date(1700000000000) }),
		{ authId: "auth_9", _creationTime: 1700000000000 });
});

test("an incomplete recipe yields a patch inverse that maps only the keys present", () => {
	const pipeline = reshape<Doc>()
		.omit("passwordHash", "_id")
		.rename({ authId: "id", _creationTime: "createdAt" })
		.retype({ createdAt: (t) => new Date(t) });

	const patch = pipeline.invert({ createdAt: (d) => d.getTime() });
	assert.deepEqual(patch({ id: "auth_9" }), { authId: "auth_9" });
	assert.deepEqual(patch({ createdAt: new Date(5) }), { _creationTime: 5 });
});

test("a transformed key absent from a patch is skipped, not mistaken for a reconstructor", () => {
	// Regression: classifying recipe entries by "is this key present in the
	// input" silently ran the reverse function against the whole patch.
	// The pipeline must DROP something for `invert` to hand back a patch
	// inverse; one that drops nothing yields a total inverse, which rightly
	// demands the whole object.
	const pipeline = reshape<{ name: string; _creationTime: number; secret: string }>()
		.omit("secret")
		.rename({ _creationTime: "createdAt" })
		.retype({ createdAt: (t) => new Date(t) });

	const patch = pipeline.invert({ createdAt: (d) => d.getTime() });
	const out = patch({ name: "Ada" });

	assert.deepEqual(out, { name: "Ada" });
	assert.equal("createdAt" in out, false);
	assert.equal("_creationTime" in out, false);
});

test("a patch inverse never emits an absent key as undefined", () => {
	// `{ passwordHash: undefined }` is not the same as omitting it: a document
	// store will read it as an instruction to unset the column.
	const pipeline = reshape<Doc>().omit("passwordHash").rename({ authId: "id" });
	const out = pipeline.invert()({ name: "Ada" });

	assert.deepEqual(Object.keys(out), ["name"]);
	assert.equal("passwordHash" in out, false);
	assert.equal("authId" in out, false);
});

test("fields added by extend are dropped on the way back", () => {
	const pipeline = reshape<{ a: string }>().extend({ source: "api" as const });
	assert.deepEqual(pipeline.invert()({ a: "x", source: "api" }), { a: "x" });
});

test("a complete recipe reconstructs dropped fields for a total inverse", () => {
	const pipeline = reshape<Doc>()
		.omit("passwordHash", "_id")
		.rename({ authId: "id" });

	const total = pipeline.invert({
		_id: () => "generated_id",
		passwordHash: () => "",
	});

	assert.deepEqual(total({ id: "auth_9", _creationTime: 1, name: "Ada" }), {
		_id: "generated_id",
		passwordHash: "",
		authId: "auth_9",
		_creationTime: 1,
		name: "Ada",
	});
});

test("a reconstructor returning undefined contributes no key", () => {
	const pipeline = reshape<Doc>().omit("_id").rename({ authId: "id" });
	const out = pipeline.invert({ _id: () => undefined as never })({
		id: "auth_9", _creationTime: 1, name: "Ada", passwordHash: "",
	});
	assert.equal("_id" in out, false);
});

test("reconstructors receive the whole input object", () => {
	const pipeline = reshape<{ slug: string; title: string }>().omit("slug");
	const total = pipeline.invert({ slug: (o) => o.title.toLowerCase().replace(/\s+/g, "-") });
	assert.deepEqual(total({ title: "Hello World" }), { title: "Hello World", slug: "hello-world" });
});

test("invert round-trips a realistic pipeline", () => {
	const pipeline = reshape<Doc>()
		.omit("passwordHash")
		.rename({ authId: "id", _creationTime: "createdAt", _id: "docId" })
		.retype({ createdAt: (t) => new Date(t) });

	const forward = pipeline.build();
	const back = pipeline.invert({ createdAt: (d) => d.getTime(), passwordHash: () => "restored" });

	const source: Doc = {
		_id: "row_1", _creationTime: 1700000000000, authId: "auth_9",
		name: "Ada", passwordHash: "$2b$xxx",
	};

	assert.deepEqual(back(forward(source)), { ...source, passwordHash: "restored" });
});
