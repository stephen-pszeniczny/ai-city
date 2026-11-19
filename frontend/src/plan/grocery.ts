// Helpers for the grocery list: short count labels and how many items are ticked.
import type { GroceryList } from "../api";

/** "empty", "1 item", "6 items": for the grocery-day marker and the check-in. */
export const itemCountLabel = (open: number): string =>
  open === 0 ? "empty" : open === 1 ? "1 item" : `${open} items`;

export const tickedCount = (list: GroceryList): number => list.items.filter((i) => i.ticked).length;
