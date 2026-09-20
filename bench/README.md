# Benchmarks

Two costs, measured separately, because they land on different people.

| | what it measures | run it |
| --- | --- | --- |
| `runtime.bench.mjs` | what a compiled mapper costs per call | `npm run bench` |
| `types.bench.mjs` | what a pipeline costs the compiler | `npm run bench:types` |
| `fixture-shapes.bench.mjs` | a guard on the benchmarks themselves | `node bench/fixture-shapes.bench.mjs` |

Both read from `dist/`, so build first — the `npm run` scripts do it for you.
`npm run bench:all` runs both.

```
node bench/runtime.bench.mjs --filter invert
node bench/types.bench.mjs --filter per-operator
node bench/types.bench.mjs --json            # for CI ceilings
node bench/types.bench.mjs --trace op-at     # profile one scenario
```

## Reading the type numbers

Use the **instantiations** column, not the clock. Instantiation count is
deterministic — the same fixture gives the same number on any machine — while
check time on the native compiler is a few milliseconds and mostly noise. Every
row is reported as a delta over a baseline that imports the library and does
nothing.

Fixtures that fail to compile are flagged and exit non-zero. A fixture with a
type error can short-circuit the very instantiation it was written to price, so
its number is meaningless rather than merely wrong.

## What the first run found

Measured on an M3 / Node 24 / TypeScript 7.0.2. Numbers will differ on your
machine; the ratios are the point.

**`delete` is the dominant runtime cost.** `applyOp` mutates a working object
it owns, which saves a copy per step, but `omit` and `rename` do it with
`delete`. A deleted key drops the object into V8's dictionary mode, and it
stays slow for the rest of the pipeline:

| | |
| --- | --- |
| copy a 6-key object | 22ns |
| copy, delete 1 key | 210ns |
| copy, delete 1, copy again | 962ns |
| construct without the key | 2.7ns |

That is the whole story behind `rename` costing 375ns against `pick`'s 128ns.

**But it is not where the gap to hand-written lives.** Measured against a real
patched build, removing `delete` entirely is worth 1.57x — the remaining cost
is five object allocations with dynamic key stores, where a hand-written
transform does one literal with a fixed hidden class. Per 1000 rows:

| | | |
| --- | --- | --- |
| hand-written | 66µs | 1.0x |
| fused, codegen (`new Function`) | 70µs | 1.06x |
| fused, plan loop (no eval) | 162µs | 2.4x |
| `delete` removed, still per-op | 433µs | 6.6x |
| current | 678µs | 10.3x |

Fusing the ops into one pass at build time is worth ~4x more than the `delete`
fix, and codegen lands within 6% of hand-written. Neither is implemented, and
neither is obviously worth it — see the note on `build()` below.

**`build()` compiles nothing.** Reusing a built mapper beats calling `.build()`
per call by 1.07x — all the op dispatch happens per call, so there is real
headroom in doing the work once at build time. It is a finalizer in the
builder-pattern sense, not a compiler: the plan is already reified as data by
`explain`, and nothing consumes it for execution.

`invert` used to have the same problem, and worse: it recomputed
`transformedKeys(ops)` — a walk of the whole pipeline, allocating Sets, with a
nested `includes` — inside the returned closure, on every call. Settling it
once when `invert` is called took the inverse from 1.20µs to 972ns, and from
992ns to 422ns on a 16-op pipeline. The inverse is now flatter with depth than
the forward mapper, since the forward path still re-walks its ops per call.

**`at`/`each` cost ~36x any other operator at the type level**, ~9,200
instantiations against 263 for `pick`. The signature takes
`R | ((nested: Reshaper<Out[K]>) => R)`, so inferring `R` instantiates a whole
`Reshaper` for the nested type.

But it is a **one-time** cost, which is the reassuring part: a second `at` adds
~200 instantiations, and a *nested* one ~485. Ten sibling `at` calls in a file
cost 11,048 against 9,212 for one. Reach for `at` freely once you have reached
for it at all.

**Consumers pay almost nothing.** Declaration emit is fully flattened —
`Simplify` collapses the pipeline types at the `.d.ts` boundary, so a
downstream package never sees `Reshaper`, `DistributiveOmit` or a conditional
type:

| mappers exported | `.d.ts` | per mapper | consumer instantiations |
| --- | --- | --- | --- |
| 1 | 670 B | 670 B | 30 |
| 10 | 6,700 B | 670 B | 273 |
| 50 | 33,700 B | 674 B | 1,353 |

Dead linear. The ~9,200 instantiations that `at` costs are paid once by the
mapper's author and never by anyone downstream. (Branding `build()`'s return
type as `Built` for the `at` fix costs ~12% of that `.d.ts` size and roughly
doubles the consumer count, from 598 B / 703 instantiations at 50 mappers.
Both are small enough to be worth closing a silent field leak.)

**Cost amortizes across files, not just within one.** Fifty separate files
each defining a pipeline cost 17,412 instantiations — 348 per file, down from
535 for a single file. Fifty files each using `at` cost 93,682 total, roughly
1,167 marginal per file after the first pays the entry cost. Spreading mappers
across a codebase is the cheap direction.

**Everything else scales fine.** Source width is mild (253 → 728 instantiations
from 5 to 100 keys). Union sources stay linear (~278 per member), which matters
because `DistributivePick`/`DistributiveOmit` distribute. Thirty pipelines in
one file cost ~128 each with no quadratic term. Pipeline depth is mildly
superlinear — 299 at one op, 9,395 at sixteen — worth watching but not alarming
at realistic lengths.

**`invert` roughly triples a small pipeline.** Each row below is differenced
against a control running the identical pipeline without the `.invert(...)`,
so the delta is the inverse and nothing else:

| | instantiations | cost of inverting |
| --- | --- | --- |
| `pick`+`rename`, forward only | 519 | — |
| …`.invert()` | 1,530 | +1,011 |
| `pick`+`rename`+`retype`, forward only | 834 | — |
| …`.invert({fn})` | 1,963 | +1,129 |
| …`.invert({fn, ...3 reconstructors})` | 2,232 | +1,398 |

Around 1,000 instantiations to reach for `invert` at all, and only ~390 more
for a total inverse over a bare one. `Recipe`, `NoExtraKeys`, `SuppliedKeys`
and `InverseOf` are the heaviest types in the library and this is where they
get paid for. Affordable, but not free the way the forward operators are —
worth knowing before putting `invert` in a hot module.

## A trap worth knowing about

Every pipeline opens with `{ ...source }`, so the spread is the floor under
every runtime number here — and that floor moves by **100x** depending on
nothing but how the source object was built:

| a 100-key object built by | spread cost |
| --- | --- |
| object literal | 162ns |
| `JSON.parse` | 161ns |
| `Object.fromEntries` | 164ns |
| assigning keys in a loop | 16.5µs |

Build a width fixture the obvious way, with a `for` loop, and the suite reports
that Reshape takes 17µs to pick three keys from a hundred. It does not. Nothing
a caller actually passes — a parsed response body, an object literal, a driver
row — is in the slow bucket.

There is a second cliff in the same family: past roughly 130 keys V8 stops
giving an object fast properties, and spread jumps from 210ns at 129 keys to
5.8µs at 150. Above the cliff the numbers stop being reproducible — the same
400-key fixture measured anywhere from 833ns to 28µs in one session, depending
only on what ran before it. That is why the width sweep in `runtime.bench.mjs`
stops at 100, and why nothing above the cliff belongs in a regression suite.

`fixture-shapes.bench.mjs` pins both effects so they cannot quietly come back.
Run it when a width number looks alarming, before believing it.
