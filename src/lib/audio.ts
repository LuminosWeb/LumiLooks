export function originalVolume(value: unknown = 100) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 100;
}
