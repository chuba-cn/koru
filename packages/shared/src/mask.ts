export function maskTail(value: string, visible = 4): string {
  if (value.length <= visible) return value;

  return '*'.repeat(value.length - visible) + value.slice(-visible);
}
