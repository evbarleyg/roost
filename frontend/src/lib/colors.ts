// Score color scale (1=poor red -> 5=great green), used for the rank table's score
// column, score badges, and map markers. Returns {bg, text} hex pairs with enough
// contrast to put text on top.

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function mix(c1: [number, number, number], c2: [number, number, number], t: number): string {
  const r = Math.round(lerp(c1[0], c2[0], t));
  const g = Math.round(lerp(c1[1], c2[1], t));
  const b = Math.round(lerp(c1[2], c2[2], t));
  return `rgb(${r}, ${g}, ${b})`;
}

// red -> amber -> green stops
const RED: [number, number, number] = [220, 38, 38];
const AMBER: [number, number, number] = [217, 161, 24];
const GREEN: [number, number, number] = [21, 128, 61];

export function scoreColor(score: number | null | undefined): { bg: string; fg: string } {
  if (score == null) return { bg: "#f3f4f6", fg: "#9ca3af" };
  const clamped = Math.max(1, Math.min(5, score));
  const t = (clamped - 1) / 4; // 0..1
  const bg = t < 0.5 ? mix(RED, AMBER, t / 0.5) : mix(AMBER, GREEN, (t - 0.5) / 0.5);
  return { bg, fg: "#ffffff" };
}

// Soft tint version for table cells (dark text on a pale wash).
export function scoreTint(score: number | null | undefined): { bg: string; fg: string } {
  if (score == null) return { bg: "transparent", fg: "#9ca3af" };
  const clamped = Math.max(1, Math.min(5, score));
  const t = (clamped - 1) / 4;
  const pale = (c: [number, number, number]) =>
    mix(c, [255, 255, 255], 0.78);
  const bg = t < 0.5 ? pale(RED) : t < 0.85 ? pale(AMBER) : pale(GREEN);
  return { bg, fg: "#1f2937" };
}
