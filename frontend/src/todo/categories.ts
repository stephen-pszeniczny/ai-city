// The four task categories, in the order the menu shows them.
// IDs match the backend; labels are plain generic words (day-job tasks show as "Work").
import type { Category } from "../api";

export const CATEGORIES: readonly { id: Category; label: string }[] = [
  { id: "personal", label: "Personal" },
  { id: "work", label: "Work" },
  { id: "side_work", label: "Side work" },
  { id: "city", label: "City" },
];

export const categoryLabel = (id: Category): string =>
  CATEGORIES.find((c) => c.id === id)?.label ?? id;
