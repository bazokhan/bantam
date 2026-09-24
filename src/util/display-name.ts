const forbidden = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu;

export function sanitizeDisplayName(input: unknown): string {
  const clean = String(input ?? "")
    .normalize("NFKC")
    .replace(forbidden, "")
    .replace(/\s+/gu, " ")
    .trim();
  const segments = [...new Intl.Segmenter("en", { granularity: "grapheme" }).segment(clean)];
  return (
    segments
      .slice(0, 24)
      .map((item) => item.segment)
      .join("") || "Player"
  );
}
