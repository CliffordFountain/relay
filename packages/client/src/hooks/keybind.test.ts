import { describe, it, expect } from 'vitest';
import {
  loneModifierBind,
  isLoneModifierBind,
  mouseButtonBind,
  isMouseBind,
  eventToKeybindString,
  keyboardMatchesBind,
  mouseMatchesBind,
} from './keybind';

describe('keybind helpers', () => {
  it('recognizes lone modifier keys', () => {
    expect(loneModifierBind('Control')).toBe('Ctrl');
    expect(loneModifierBind('Shift')).toBe('Shift');
    expect(loneModifierBind('Alt')).toBe('Alt');
    expect(loneModifierBind('Meta')).toBe('Meta');
    expect(loneModifierBind('a')).toBeNull();
    expect(isLoneModifierBind('Ctrl')).toBe(true);
    expect(isLoneModifierBind('F')).toBe(false);
  });

  it('maps mouse buttons, ignoring left/right', () => {
    expect(mouseButtonBind(1)).toBe('Mouse3'); // middle
    expect(mouseButtonBind(3)).toBe('Mouse4'); // back / side
    expect(mouseButtonBind(4)).toBe('Mouse5'); // forward / side
    expect(mouseButtonBind(0)).toBeNull(); // left stays usable
    expect(mouseButtonBind(2)).toBeNull(); // right stays usable
    expect(isMouseBind('Mouse4')).toBe(true);
    expect(isMouseBind('F')).toBe(false);
  });

  it('builds combo strings', () => {
    expect(eventToKeybindString({ key: 'f' } as KeyboardEvent)).toBe('F');
    expect(
      eventToKeybindString({ key: 'm', ctrlKey: true, shiftKey: true } as KeyboardEvent),
    ).toBe('Ctrl+Shift+M');
  });

  it('matches a lone modifier on both press and release', () => {
    // keydown: Control held (ctrlKey true)
    expect(keyboardMatchesBind('Ctrl', { key: 'Control', ctrlKey: true } as KeyboardEvent)).toBe(true);
    // keyup: Control releasing (ctrlKey already cleared) still matches by key name
    expect(keyboardMatchesBind('Ctrl', { key: 'Control', ctrlKey: false } as KeyboardEvent)).toBe(true);
    // "Ctrl" bind must NOT match a Ctrl+A combo
    expect(keyboardMatchesBind('Ctrl', { key: 'a', ctrlKey: true } as KeyboardEvent)).toBe(false);
  });

  it('matches plain keys and combos', () => {
    expect(keyboardMatchesBind('F', { key: 'f' } as KeyboardEvent)).toBe(true);
    expect(
      keyboardMatchesBind('Ctrl+Shift+M', { key: 'm', ctrlKey: true, shiftKey: true } as KeyboardEvent),
    ).toBe(true);
    // a mouse bind never matches a keyboard event
    expect(keyboardMatchesBind('Mouse4', { key: 'a' } as KeyboardEvent)).toBe(false);
  });

  it('matches mouse-button binds', () => {
    expect(mouseMatchesBind('Mouse4', { button: 3 } as MouseEvent)).toBe(true);
    expect(mouseMatchesBind('Mouse4', { button: 0 } as MouseEvent)).toBe(false);
    expect(mouseMatchesBind('F', { button: 3 } as MouseEvent)).toBe(false);
  });
});
