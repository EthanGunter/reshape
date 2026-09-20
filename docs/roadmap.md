# Roadmap

Ideas worth keeping, deliberately kept out of the README so they don't read as
promises. Nothing here is committed to.

## `.strict()`

Construct the output from a runtime key manifest rather than by deleting keys
from the source, which would make `.omit()` safe at a trust boundary.

Today `.omit()` is a denylist over runtime keys, so a field that exists on the
object but not in its TypeScript type passes straight through — see the
failure case in the README. A manifest captured at build time would let the
pipeline build its result the way `.pick()` does, from an allowlist, while
still being *written* as a denylist.

Open question: where the manifest comes from. Requiring the caller to pass one
defeats the ergonomics; deriving it needs a runtime source of truth for the
type, which is really the next item.

## `reshape.from(schema)`

Seed a pipeline from any [Standard Schema](https://standardschema.dev) library
(Zod, Valibot, ArkType) to get both the static type *and* a runtime list of
keys from one declaration.

This would make `.strict()` fall out for free, and it closes the "Reshape does
not validate" limitation for anyone already holding a schema. Standard Schema
means one integration covers the major validators instead of one adapter each.

Cost: it introduces a notion of a "source of truth" object that the current
API doesn't have, and the peer-dependency-free story gets more complicated.
