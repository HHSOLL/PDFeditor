export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function isNumberArray(
  value: unknown,
  length: number,
): value is [number, number, number, number, number, number] {
  return (
    Array.isArray(value) &&
    value.length === length &&
    value.every((entry) => typeof entry === "number")
  );
}

export function multiplyMatrix(
  a: [number, number, number, number, number, number],
  b: [number, number, number, number, number, number],
): [number, number, number, number, number, number] {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

export function isMostlyHorizontalText(
  matrix: [number, number, number, number, number, number],
): boolean {
  const baselineAngle = Math.abs(Math.atan2(matrix[1], matrix[0]));
  const normalizedAngle = Math.min(baselineAngle, Math.abs(Math.PI - baselineAngle));
  return normalizedAngle < Math.PI / 12;
}
