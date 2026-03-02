export type Simplify<T> =
  // don't touch functions
  T extends (...args: any[]) => any ? T :
  // don't expand common built-ins / class instances you want atomic
//   T extends Builtins ? T :
  // arrays/tuples: simplify their elements
  T extends readonly (infer U)[] ? { [K in keyof T]: Simplify<T[K]> } :
  // objects: mapped type to "re-materialize" the shape
  T extends object ? { [K in keyof T]: Simplify<T[K]> } :
  // primitives
  T;