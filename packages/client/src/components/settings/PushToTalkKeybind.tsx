import { useEffect, useState } from 'react';
import { useAppSelector, useAppDispatch } from '../../hooks/useAppDispatch';
import { setKeybind } from '../../stores/settingsSlice';
import { loneModifierBind, mouseButtonBind, eventToKeybindString } from '../../hooks/keybind';
import styles from './userSettings.module.scss';

const PTT_ACTION = 'Push to Talk';

/**
 * Inline Push-to-Talk shortcut recorder, shown in Voice & Video when input mode is
 * Push to Talk. Records into the same `Push to Talk` keybind that usePushToTalk reads,
 * so setting it here is what actually makes PTT work (previously the only recorder was
 * buried in a separate Keybinds section, so PTT mode had no visible way to bind a key).
 */
export function PushToTalkKeybind() {
  const dispatch = useAppDispatch();
  const keybinds = useAppSelector((s) => s.settings.keybinds);
  const pttIndex = keybinds.findIndex((kb) => kb.action === PTT_ACTION);
  const pttKey = pttIndex >= 0 ? keybinds[pttIndex]?.key ?? '' : '';
  const [recording, setRecording] = useState(false);

  useEffect(() => {
    if (!recording || pttIndex < 0) return;
    const commit = (key: string) => {
      dispatch(setKeybind({ index: pttIndex, key }));
      setRecording(false);
    };
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        setRecording(false);
        return;
      }
      // A lone modifier (Ctrl / Shift / Alt / Meta) is a perfectly good PTT key on its
      // own — bind it directly instead of waiting for a "real" key.
      const mod = loneModifierBind(e.key);
      if (mod) {
        commit(mod);
        return;
      }
      commit(eventToKeybindString(e));
    };
    const onMouse = (e: MouseEvent) => {
      const bind = mouseButtonBind(e.button);
      if (!bind) return; // left/right click stay usable for the UI
      e.preventDefault();
      e.stopPropagation();
      commit(bind);
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('mousedown', onMouse, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('mousedown', onMouse, true);
    };
  }, [recording, pttIndex, dispatch]);

  return (
    <div className={styles.formGroup}>
      <label className={styles.formLabel}>PUSH TO TALK SHORTCUT</label>
      <button
        type="button"
        className={`${styles.keybindKey} ${recording ? styles.recording : ''}`}
        onClick={() => setRecording((r) => !r)}
        aria-label="Set Push to Talk keybind"
        data-testid="ptt-keybind"
      >
        {recording ? 'Press a key or mouse button…' : pttKey || 'Click to set a key'}
      </button>
      <p className={styles.optionHint}>
        Hold this key (or mouse button) while connected to a voice channel to talk. Any key
        works, including modifiers like Ctrl or the side buttons on your mouse. Press Escape to
        cancel.
      </p>
    </div>
  );
}
