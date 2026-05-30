export const money = (n: number | null | undefined): string =>
  n == null ? "—" : `$${Math.round(n).toLocaleString()}`;

export const ppsqft = (n: number | null | undefined): string =>
  n == null ? "—" : `$${n.toFixed(2)}`;

export const minutes = (n: number | null | undefined): string =>
  n == null ? "—" : `${Math.round(n)} min`;

export const score = (n: number | null | undefined): string =>
  n == null ? "—" : n.toFixed(2);

export const num = (n: number | null | undefined, suffix = ""): string =>
  n == null ? "—" : `${n}${suffix}`;
