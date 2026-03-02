# Reshape

[![npm version](https://img.shields.io/npm/v/Reshape.svg)](https://www.npmjs.com/package/Reshape)
[![license](https://img.shields.io/npm/l/Reshape.svg)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/types-included-blue.svg)]()

A tiny, zero-dependency TypeScript utility for building type-safe object
derivations from a single source of truth.

---

## Why Reshape?

Your database schema, API response type, or any other canonical data structure should be the **one true definition** for your entire codebase. When it changes, everything downstream should change with itautomatically, with full type safety, and zero manual busywork.

`Reshape` gives you a fluent, chainable builder to derive new shapes from any TypeScript object. Omit sensitive fields, rename keys for a public API, recast values to different types, all while keeping TypeScript's type system perfectly in sync at every step.

---

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Examples](#examples)
  - [Hiding sensitive fields](#hiding-sensitive-fields)
  - [Building a public API response](#building-a-public-api-response)
  - [Transforming field types](#transforming-field-types)
  - [Composing multiple transforms](#composing-multiple-transforms)
- [API Reference](#api-reference)
- [Limitations](#limitations)
- [Contributing](#contributing)
- [License](#license)

---

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

> **Requirements:** TypeScript 5.0+, ESM project (`"type": "module"` or bundler that handles ESM).

---

## Examples

### Hiding sensitive fields

Strip internal or sensitive fields before sending data to a client. The derived
type updates automatically. No separate `Omit<...>` type needed.

```ts
import { Reshape } from "Reshape";
import type { Doc } from "./db"; // your DB row type

const PRIVATE_FIELDS = ["passwordHash", "mfaSecret", "stripeCustomerId"] as const;
type PrivateFields = (typeof PRIVATE_FIELDS)[number];

// The return type is automatically the shape of your user, without any private data
export const toPublicUser = (user: Doc<"users">) =>
  Reshape(user).omit(...PRIVATE_FIELDS).done();
```

If you ever add `internalNotes` to `Doc<"users">` and it shouldn't be
exposed, just add it to `PRIVATE_FIELDS`. Every consumer automatically stops
receiving it.

---

### Transforming field types

Use `retype` to apply a function to a field's value and have the return type
automatically reflected:

```ts
import { Reshape } from "Reshape";

const record = {
  id: 42,
  createdAt: 1700000000000, // Unix ms timestamp from DB
  score: "98.6",            // stored as string, needed as number
};

const cleaned = Reshape(record)
  .retype({
    createdAt: (ms) => new Date(ms),
    score: (s) => parseFloat(s),
  })
  .done();

// Inferred type:
// { id: number; createdAt: Date; score: number }
```

---

### Building a public API response

Rename internal field names to a public-friendly shape, and strip
implementation details like internal IDs:

```ts
import { Reshape } from "Reshape";
import type { Doc } from "./db";

export type UserPublic = ReturnType<typeof toUserPublic>;

export const toUserPublic = (user: Doc<"users">) =>
  Reshape(user)
    .omit("_id", "passwordHash")
    .rename({ authId: "id", _creationTime: "createdAt" })
    .done();

// Input:  { _id, authId, passwordHash, _creationTime, name, email }
// Output: { id, createdAt, name, email }
//
// The output type is fully inferreo manual type definition required.
```

---

### Composing multiple transforms

All methods are chainable and each step fully refines the TypeScript type:

```ts
import { Reshape } from "Reshape";

type Product = {
  _id: string;
  _creationTime: number;
  internalSku: string;
  name: string;
  priceInCents: number;
  isArchived: boolean;
};

export type ProductDTO = ReturnType<typeof toProductDTO>;

export const toProductDTO = (product: Product) =>
  Reshape(product)
    .omit("_id", "isArchived", "internalSku")
    .rename({ _creationTime: "createdAt" })
    .retype({ priceInCents: (cents) => cents / 100 })
    .extend({ currency: "USD" as const })
    .done();

// Inferred type:
// {
//   createdAt: number;
//   name: string;
//   priceInCents: number;  <-- now typed as number (was number/100)
//   currency: "USD";
// }
```

---

## API Reference

All methods return a new `DTOBuilder`  the original object is never mutated.

### `Reshape(source)`

Entry point. Wraps any object and returns a `DTOBuilder<T>`.

```ts
import { Reshape } from "Reshape";
const builder = Reshape(myObject);
```

---

### `.omit(...keys)`

Removes one or more keys from the shape.

```ts
Reshape(user).omit("passwordHash", "_id");
```

---

### `.pick(...keys)`

Keeps only the specified keys, dropping everything else.

```ts
Reshape(user).pick("id", "name", "email");
```

---

### `.rename(mapping)`

Renames keys. The mapping is `{ oldKey: "newKey" }`. Old keys are removed from
the type; new keys are added with the same value type.

```ts
Reshape(user).rename({ _creationTime: "createdAt", authId: "id" });
```

---

### `.retype(mapping)`

Transforms field values using functions. The return type of each function
becomes the new type for that key.

```ts
Reshape(record).retype({
  createdAt: (ms: number) => new Date(ms),
  tags: (raw: string) => raw.split(","),
});
```

---

### `.extend(fields)`

Merges additional fields into the shape. Useful for adding computed or
constant values.

```ts
Reshape(product).extend({ version: 2, source: "api" as const });
```

---

### `.done()`

Finalizes the builder and returns the plain object with its fully inferred type.

```ts
const result = Reshape(data).omit("secret").done();
```

---

### Exported types

```ts
import type { DTOBuilder, RenameKeys, Retype } from "Reshape";
```

| Type | Description |
|---|---|
| `DTOBuilder<T>` | The builder interface returned by `Reshape()` |
| `RenameKeys<T, Mapping>` | Utility type: rename keys on a type |
| `Retype<T, R>` | Utility type: replace key types on a type |

---

## Limitations

- Transforms apply to **top-level fields only**. Nested object transformation
  is not yet supported (coming soon).
- `retype` applies transforms at **runtime**. The TypeScript type will reflect
  the return type of your function, so make sure the runtime value matches.

---

## Contributing

PRs are welcome! For significant changes, please open an issue first to discuss
what you'd like to change.

1. Fork the repo and create your branch from `main`
2. Make your changes
3. Open a pull request

Bug reports and feature requests can be filed via
[GitHub Issues](https://github.com/TODO/Reshape/issues).

---

## License

[MIT](./LICENSE) © 2026 Ethan Gunter