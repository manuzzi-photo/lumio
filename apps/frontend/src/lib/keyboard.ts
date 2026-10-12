/**
 * Keyboard shortcuts (lightbox, slideshow, studio viewer) must not fire while
 * someone is typing. Otherwise Space in the comment field likes the photo,
 * an arrow key jumps to the next photo and "1" sets a colour label (#67).
 */

/** True if the key event comes from a field the user types into or operates
 *  with the keyboard: text inputs, textareas, selects, contenteditable, and
 *  also checkboxes, radios and sliders (Space and arrows belong to them). */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/**
 * Shared guard for global shortcut handlers. Returns true when the handler
 * should do nothing. Escape inside a field only leaves the field (blur), so a
 * half-written comment is not thrown away by closing the viewer.
 */
export function shouldIgnoreShortcut(e: KeyboardEvent): boolean {
  if (e.isComposing) return true; // IME input (e.g. Japanese) in progress
  if (!isTypingTarget(e.target)) return false;
  if (e.key === "Escape") (e.target as HTMLElement).blur();
  return true;
}
