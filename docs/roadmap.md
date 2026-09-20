# Roadmap

Ideas worth keeping, deliberately kept out of the README so they don't read as
promises. Nothing here is committed to.

## `reshape.from(schema)`

Seed a pipeline from any [Standard Schema](https://standardschema.dev) library
(Zod, Valibot, ArkType) to get both the static type *and* a runtime list of
keys from one declaration.

This closes the "Reshape does not validate" limitation for anyone already
holding a schema, and Standard Schema means one integration covers the major
validators instead of one adapter each.

Cost: it introduces a notion of a "source of truth" object that the current
API doesn't have, and the peer-dependency-free story gets more complicated.
Additive, though — a new entry point alongside `reshape<T>()`, changing
nothing about how existing pipelines behave.

## Rejected

### `.strict()`

Would have built the output from a runtime key manifest, so `.omit()` could be
written as a denylist while behaving like an allowlist at a trust boundary.

**Rejected 2026-09-20.** `.pick()` is already `omit` + `strict` with less
effort. Allowlist construction is the entire mechanism that makes it safe, and
`.pick()` expresses that directly with no manifest to source, no second way to
say the same thing, and nothing new to explain. The failure case in the README
is documentation, not a gap to close.
