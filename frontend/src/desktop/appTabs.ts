// Small rules for the desk computer's left app list (pure, so they're tested alone).

/** Past eight apps the list scrolls instead of squeezing its buttons. */
export function appListLayout(count: number): { scroll: boolean } {
  return { scroll: count > 8 };
}

/** How switching apps looks: a quick slide-and-fade, or instant with Reduce Motion. */
export function switchMode(reduceMotion: boolean): "instant" | "slide" {
  return reduceMotion ? "instant" : "slide";
}
