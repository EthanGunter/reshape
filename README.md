# Reshape

[npm version](https://www.npmjs.com/package/@ethangunter/reshape)
[license](./LICENSE)
[TypeScript]()

A tiny, zero-dependency TypeScript utility for building type-safe object derivations from a single source of truth.

## Why Reshape?

Your database schema, API response type, or any other canonical data structure should be the **one true definition** for your entire codebase. When it changes, everything downstream should change with it, automatically, with full type safety, and zero manual busywork.

**Reshape** gives you a fluent, chainable builder to derive new shapes from any TypeScript object. Omit sensitive fields, rename keys for a public API, recast values to different types, all while keeping TypeScript's type system perfectly in sync at every step.

## Installation

```bash
npm install @ethangunter/reshape
```

```bash
pnpm add @ethangunter/reshape
```

```bash
yarn add @ethangunter/reshape
```

> **Requirements:** TypeScript 5.0+, ESM project (`"type": "module"` or a bundler that handles ESM).

## Use Case Example

You've got a user defined like so

```ts
type User = {
  _id: string;            // DB-bound naming
  _creationTime: number;  // DB-bound naming
  authId: string;         // Canonical id - frontend doesn't need to know it's auth-related
  name: string;
  email: string;          // Potentially sensitive in public user-searches
  passwordHash: string;   // DON'T SEND OUT OF DB
};
```

You want a clean, public-facing shape with no sensitive data, friendlier key names, and proper types.
With Reshape:

```ts
export const toPublicUser = (user: User) =>
  reshape(user)
    // Strip sensitive internal fields
    .omit("_id", "passwordHash", "internalNotes")

    // Expose stable, public-friendly names instead of internal conventions
    .rename({ authId: "id", _creationTime: "createdAt" })

    // Convert values into the types consumers actually want
    .retype({ createdAt: t => new Date(t) })

    // Add any fields you want
    .extend({ source: "api" as const })
    .done();

```
And you get a runtime AND compile-time safe object out, no manual type definition required:
```ts
ReturnType<typeof toPublicUser> = {
  id: string;       // No _id, no authId, no mental overhead
  createdAt: Date;  // _creationTime is now an object we can work with
  name: string;
  email: string;
  source: "api";
}
```
No private fields compromising user privacy, and the compiler enforces it automatically!
Change a field in `User` and every derived type and consumer updates with it.

## API Reference

All methods return a new builder. The original object is never mutated. Call `.done()` to get the final typed object.


| Method             | Description                                                              |
| ------------------ | ------------------------------------------------------------------------ |
| `.omit(...keys)`   | Remove one or more keys                                                  |
| `.pick(...keys)`   | Keep only the specified keys                                             |
| `.rename(mapping)` | Rename keys via `{ oldKey: "newKey" }`                                   |
| `.retype(mapping)` | Transform values via `{ key: (val) => newVal }`, return type is inferred |
| `.extend(fields)`  | Merge in additional fields                                               |
| `.done()`          | Finalize and return the object with its inferred type                    |


### Exported types

```ts
import type { reshape, RenameKeys, Retype } from "@ethangunter/reshape";
```

| Type                     | Description                                   |
| ------------------------ | --------------------------------------------- |
| `Rename<Type, Mapping>`  | Utility type: rename keys on a type           |
| `Retype<Type, Mapping>`  | Utility type: replace value types on a type   |


## Limitations

- Transforms apply to **top-level fields only**. Nested transformation is not yet supported (coming soon).
- `retype` transforms are applied at runtime. The inferred type reflects your function's return type, so make sure they match.

## Contributing

PRs are welcome! For significant changes, please open an issue first to discuss what you'd like to change. Bug reports and feature requests can be filed via [GitHub Issues](https://github.com/EthanGunter/reshape/issues).

## License

[MIT](./LICENSE) © 2026 Ethan Gunter