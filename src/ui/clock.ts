/**
 * The current time, for event handlers and saves. Kept in one place so
 * render code never reads the clock directly (screens get "now" from the store).
 */
export function nowMs(): number {
  return Date.now();
}
