// The ticker: a slim glass strip at the bottom of the belt (and inside buildings,
// not on the computer screen) that cycles every active notification, one at a time.
// Each one can be dismissed; clicking its title flies to the task in Mission
// Control. It stays until dismissed or the task is finished (opening it doesn't
// count). With reduced motion it doesn't move on by itself: small ‹ › buttons do.
// It also holds still while the pointer is over it or focus is inside it, so
// Dismiss can never land on a different reminder than the one you aimed at.
import { useEffect, useState } from "react";

import type { NotificationItem } from "../api";
import { LOOK } from "../belt/look";
import { nextTickerIndex, shortTitle, tickerPosition, tickerShouldRotate } from "./rules";

type Props = {
  items: NotificationItem[];
  reducedMotion: boolean;
  onOpen: (taskId: number) => void;
  onDismiss: (id: number) => void;
};

export function Ticker({ items, reducedMotion, onOpen, onDismiss }: Props) {
  const [index, setIndex] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const paused = hovered || focused;
  const count = items.length;
  const shown = Math.min(index, Math.max(0, count - 1)); // the list can shrink under us

  useEffect(() => {
    if (!tickerShouldRotate({ count, reducedMotion, paused })) return;
    const id = window.setInterval(
      () => setIndex((i) => nextTickerIndex(Math.min(i, count - 1), count)),
      LOOK.notifications.tickerSecondsPerItem * 1000,
    );
    return () => window.clearInterval(id);
  }, [reducedMotion, count, paused]);

  const item = items[shown];
  if (!item) return null;
  const position = tickerPosition(shown, count);

  return (
    <aside
      className="ticker"
      aria-label="Reminders"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
      }}
    >
      <span className="ticker__dot" aria-hidden="true" />
      {reducedMotion && count > 1 && (
        <button
          type="button"
          className="ticker__step"
          aria-label="Previous reminder"
          onClick={() => setIndex((shown - 1 + count) % count)}
        >
          ‹
        </button>
      )}
      <p className="ticker__text" aria-live="polite">
        {item.task_id !== null ? (
          <button
            type="button"
            className="ticker__open"
            onClick={() => onOpen(item.task_id!)}
            title="Open this task in Mission Control"
          >
            {shortTitle(item.title, LOOK.notifications.bannerMaxChars)}
          </button>
        ) : (
          shortTitle(item.title, LOOK.notifications.bannerMaxChars)
        )}
        {position && <span className="ticker__count">{position}</span>}
      </p>
      {reducedMotion && count > 1 && (
        <button
          type="button"
          className="ticker__step"
          aria-label="Next reminder"
          onClick={() => setIndex(nextTickerIndex(shown, count))}
        >
          ›
        </button>
      )}
      <button type="button" className="ticker__dismiss" onClick={() => onDismiss(item.id)}>
        Dismiss
      </button>
    </aside>
  );
}
