/** Linear-interpolated percentile (p in 0–100) of an unsorted sample. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) throw new Error("percentile of empty sample");
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (rank - lo);
}

export function mean(values: readonly number[]): number {
  if (values.length === 0) throw new Error("mean of empty sample");
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

export const round1 = (x: number): number => Math.round(x * 10) / 10;
