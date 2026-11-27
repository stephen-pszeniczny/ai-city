// A development-only look at the upgrades: /?growthPreview=<0 to 10> shows every
// built asteroid at that tier. The production build ignores it (see BeltScene).

export function previewTier(search: string): number | null {
  const raw = new URLSearchParams(search).get("growthPreview");
  if (!raw || !Number.isFinite(Number(raw))) return null;
  return Math.min(10, Math.max(0, Math.round(Number(raw))));
}
