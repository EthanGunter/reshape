# Reshape

[![npm](https://img.shields.io/npm/v/@ethangunter/reshape.svg)](https://www.npmjs.com/package/@ethangunter/reshape)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

A tiny, zero-dependency TypeScript utility for building type-safe object derivations from a single source of truth.

## Installation

```bash
npm install @ethangunter/reshape
# pnpm add @ethangunter/reshape
# yarn add @ethangunter/reshape
```

> **Requirements:** TypeScript 5.0+, ESM project (`"type": "module"` or a bundler that handles ESM).

## Why Reshape?

Your database schema, API response type, or any other canonical data structure should be the **one true definition** for your entire codebase. When it changes, everything downstream should change with it — automatically, type-safely, with zero manual busywork.

Hand-written mappers break that promise. You write the transform, then you write an interface describing what it returns, and the two drift from the moment you save the file.

**Reshape** is a fluent, chainable builder that compiles to a plain function. Its return type *is* your derived shape, so there's no second definition to keep in sync.

## For Example

You've got a user defined like so:

```ts
type User = {
  _id: string;            // DB-bound naming
  _creationTime: number;  // DB-bound naming
  authId: string;         // Canonical id - frontend doesn't need to know it's auth-related
  name: string;
  email: string;
  passwordHash: string;   // DON'T SEND OUT OF DB
};
```

You want a clean, public-facing shape with no sensitive data, friendlier key names, and proper types. With Reshape:

```ts
import { reshape } from "@ethangunter/reshape";

export const toPublicUser = reshape<User>()
  // Build from an allowlist, so nothing sensitive is exposed
  .pick("authId", "_creationTime", "name", "email")

  // Expose stable, public-friendly names instead of internal conventions
  .rename({ authId: "id", _creationTime: "createdAt" })

  // Convert values into the types consumers actually want
  .retype({ createdAt: (t) => new Date(t) })

  // Compile the pipeline down to a plain function
  .build();
```

You get a runtime **and** compile-time safe result, with no manual type definition required:

```ts
export type PublicUser = ReturnType<typeof toPublicUser>;
// {
//   id: string;       // No _id, no authId, no mental overhead
//   createdAt: Date;  // _creationTime is now something you can work with
//   name: string;
//   email: string;
// }
```

Being an ordinary function, it composes with everything:

```ts
const one  = toPublicUser(user);
const many = users.map(toPublicUser);
```

No private fields compromising user privacy, and the compiler enforces it automatically. Change a field in `User` and every derived type and consumer updates with it.

## Limitations

- Reshape **does not validate input**. It trusts that inputs match the declared type. Pair it with a schema validator where you don't have complete control over your data

## API

```ts
import { reshape } from "@ethangunter/reshape";
```

`reshape<User>()` starts a pipeline. Every method returns a new reshaper, so pipelines are immutable and safe to share.

| Method | Description |
| --- | --- |
| [`.pick(...keys)`](#for-example) | Keep only these keys. Builds the result from an allowlist, so a key absent from the type cannot survive. |
| [`.omit(...keys)`](#omit-cannot-remove-what-the-type-cant-see) | Remove these keys, pass everything else through. ⚠️ **Prefer `.pick()` in security-sensitive contexts.** `.omit()` passes all unlisted fields through, and could easily expose a new `super_secret` field added to a DB schema with no warning. |
| [`.rename(mapping)`](#for-example) | Rename keys, as `{ oldKey: "newKey" }`. Safe for straight swaps. |
| [`.extend(fields)`](#deriving-a-field-from-several-others) | Add fields. A value is either a static, or a function of the current shape. |
| [`.retype(fns)`](#for-example) | Transform values in place, as `{ key: (value) => next }`. The new type is inferred from your function. |
| [`.at(key, …)`](#nested-objects-and-arrays) | Reshape a nested object, with another reshaper or a callback. |
| [`.each(key, …)`](#nested-objects-and-arrays) | Reshape every element of a nested array. |
| [`.build()`](#for-example) | Compile to a plain function, `(source) => result`. |
| `.run(source)` | Apply once, for when the function isn't worth naming. |
| [`.invert(recipe?)`](#inverting-a-transform) | Reverse the pipeline. Renames reverse for free; anything else is asked for in `recipe`. |
| [`.explain()`](#inspecting-the-plan) | The compiled plan, as plain data. |

## Examples

### Inverting a transform

The PATCH body, the form submission, the write back to the database. `.invert()` reverses a pipeline, asking only for what it can't work out itself.

Renames reverse for free:

```ts
const wire = reshape<{ authId: string; name: string }>().rename({ authId: "id" });
const fromWire = wire.invert();   // (value: { id, name }) => { authId, name }
```

A one-way `.retype()` needs its reverse, and the compiler names which:

```ts
const dto = reshape<User>()
  .omit("passwordHash", "_id")
  .rename({ authId: "id", _creationTime: "createdAt" })
  .retype({ createdAt: (t) => new Date(t) });

dto.invert();                                  // ✗ the inverse for createdAt is required
dto.invert({ createdAt: (d) => d.getTime() }); // ✓ `d` is inferred as Date
```

Dropped fields are optional, and decide what you get back. All of them gives a total inverse; none gives a **patch inverse**, mapping only the keys actually present:

```ts
const patch = dto.invert({ createdAt: (d) => d.getTime() });
patch({ id: "auth_9" });   // -> { authId: "auth_9" }

const total = dto.invert({
  createdAt: (d) => d.getTime(),
  _id: () => generateId(),
  passwordHash: () => "",
});
total(publicUser);         // -> a complete User
```

A patch inverse **never emits an absent key as `undefined`** — a document store reads that as an instruction to unset the field. So a request body can go straight to a granular update:

```ts
await db.patch(id, patch(req.body));   // only the keys the client actually sent
```

Reshape tracks provenance, so order doesn't matter: rename before dropping and it still knows `id` came from `authId`.

### Reusing a reshaper inside another

`.at()` takes a reshaper, not just a callback, so a mapper written once is reusable wherever that shape appears:

```ts
const toPublicProfile = reshape<Profile>().pick("bio", "avatarUrl");

const toPublicUser = reshape<User>()
  .pick("name", "profile")
  .at("profile", toPublicProfile)
  .build();
```

### Nested objects and arrays

`.at()` for an object, `.each()` for every element of an array:

```ts
const toPublicUser = reshape<User>()
  .pick("name", "profile", "posts")
  .at("profile", (r) => r.pick("bio", "avatarUrl"))
  .each("posts", (r) => r.pick("id", "title"))
  .build();

// (source: User) => {
//   name: string;
//   profile: { bio: string; avatarUrl: string };
//   posts: { id: string; title: string }[];
// }
```

### Deriving a field from several others

An `.extend()` value can be a function of the current shape:

```ts
const toListItem = reshape<User>()
  .pick("name", "email")
  .extend({
    source: "api" as const,
    displayName: (u) => `${u.name} <${u.email}>`,
  })
  .build();
```

To store a function *as* a value rather than calling it, return it: `{ handler: () => myFn }`.

### Inspecting the plan

`.explain()` returns the compiled pipeline as data — enough for a test to assert that a mapper drops what you think it drops:

```ts
reshape<User>().omit("passwordHash").rename({ authId: "id" }).explain();
// [
//   { op: "omit",   keys: ["passwordHash"] },
//   { op: "rename", mapping: { authId: "id" } },
// ]
```

## Examples - Common Pitfalls

### `omit` cannot remove what the type can't see

```ts
const row = { ...user, ssn: "078-05-1120" };   // a migration added a column; the type is stale
reshape<User>().omit("passwordHash").run(row); // -> { …, ssn: "078-05-1120" }
```

TypeScript erases at runtime, so nothing knows `ssn` was unexpected. No library can strip a field its type never mentioned.

**At a trust boundary, use `.pick()`** — it builds from an allowlist, so unknown keys are never read in the first place. Save `.omit()` for trusted internal transforms, where you *want* new fields to flow through.

### Unions only expose their shared keys

Operations distribute over unions, so a discriminated union stays discriminable:

```ts
type AppEvent =
  | { kind: "click"; x: number; id: string }
  | { kind: "key";   code: string; id: string };

reshape<AppEvent>().retype({ id: (s) => Number(s) }).build();
// (source: AppEvent) => { kind: "click"; x: number; id: number }
//                     | { kind: "key";   code: string; id: number }
```

But `keyof (A | B)` is only the **shared** keys, so `.pick("x")` won't compile. Branch first, then reshape each variant.

## Contributing

PRs are welcome! For significant changes, please open an issue first to discuss what you'd like to change. Bug reports and feature requests can be filed via [GitHub Issues](https://github.com/EthanGunter/reshape/issues).

Run `[p]npm test` — it builds, typechecks the type-level suite, and runs the runtime tests.

## License

[MIT](./LICENSE) © 2026 Ethan Gunter
