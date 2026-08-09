/**
 * Shared parsing/matching for push-to-talk (and other) keybinds.
 *
 * A recorded keybind string is one of:
 *   - a lone modifier:  "Ctrl" | "Shift" | "Alt" | "Meta"
 *   - a key combo:      "F", "Space", "Ctrl+Shift+M", ...
 *   - a mouse button:   "Mouse3" (middle) | "Mouse4" (back) | "Mouse5" (forward)
 *
 * Both the recorder (PushToTalkKeybind) and the listener (usePushToTalk) use these so
 * what you bind is exactly what gets detected — including plain modifier keys and the
 * side buttons on a mouse, which the old keyboard-combo-only logic silently dropped.
 */

const MOD_BIND_TO_KEY: Record<string, string> = {
  Ctrl: 'Control',
  Shift: 'Shift',
  Alt: 'Alt',
  Meta: 'Meta',
};

/** The bind string for a lone modifier key event (e.g. "Control" -> "Ctrl"), or null. */
export function loneModifierBind(eventKey: string): string | null {
  switch (eventKey) {
    case 'Control':
      return 'Ctrl';
    case 'Shift':
      return 'Shift';
    case 'Alt':
      return 'Alt';
    case 'Meta':
      return 'Meta';
    default:
      return null;
  }
}

export function isLoneModifierBind(bind: string): boolean {
  return bind in MOD_BIND_TO_KEY;
}

/**
 * Map a MouseEvent.button to a bind name, or null for buttons the UI needs to keep
 * (0 = left, 2 = right). 1 = middle, 3 = back (side), 4 = forward (side).
 */
export function mouseButtonBind(button: number): string | null {
  switch (button) {
    case 1:
      return 'Mouse3';
    case 3:
      return 'Mouse4';
    case 4:
      return 'Mouse5';
    default:
      return null;
  }
}

export function isMouseBind(bind: string): boolean {
  return bind === 'Mouse3' || bind === 'Mouse4' || bind === 'Mouse5';
}

/** Build the combo string for a key event, e.g. "Ctrl+Shift+M" or "F". */
export function eventToKeybindString(event: KeyboardEvent): string {
  const parts: string[] = [];
  if (event.ctrlKey) parts.push('Ctrl');
  if (event.shiftKey) parts.push('Shift');
  if (event.altKey) parts.push('Alt');
  if (event.metaKey) parts.push('Meta');
  const key = event.key;
  if (!['Control', 'Shift', 'Alt', 'Meta'].includes(key)) {
    parts.push(key.length === 1 ? key.toUpperCase() : key);
  }
  return parts.join('+');
}

/** Does a keyboard event match the bound key? Works for both keydown and keyup. */
export function keyboardMatchesBind(bind: string, event: KeyboardEvent): boolean {
  if (!bind || isMouseBind(bind)) return false;
  if (isLoneModifierBind(bind)) {
    // Match by the physical modifier key so it also matches on release, when the
    // corresponding modifier flag (ctrlKey/…) has already cleared.
    return event.key === MOD_BIND_TO_KEY[bind];
  }
  return eventToKeybindString(event) === bind;
}

/** Does a mouse event match the bound mouse button? */
export function mouseMatchesBind(bind: string, event: MouseEvent): boolean {
  if (!isMouseBind(bind)) return false;
  return mouseButtonBind(event.button) === bind;
}
