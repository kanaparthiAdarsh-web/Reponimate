// Comparator used when the caller does not pass one: ascending numeric order.
export function defaultCompare(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}
