import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useAppDispatch, useAppSelector } from '../../hooks/useAppDispatch';
import { openModal } from '../../stores/uiSlice';
import { api, type GuildScheduledEvent } from '../../api/rest';

export interface GuildEventsModalProps {
  guildId: string;
  onClose: () => void;
}

interface InterestInfo {
  interested: boolean;
  count: number;
}

const ENTITY_LABEL: Record<number, string> = { 1: 'Stage', 2: 'Voice', 3: 'External' };

export const GuildEventsModal = ({ guildId, onClose }: GuildEventsModalProps) => {
  const dispatch = useAppDispatch();
  const currentUserId = useAppSelector(s => s.auth.user?.id);
  const [events, setEvents] = useState<GuildScheduledEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [interest, setInterest] = useState<Record<string, InterestInfo>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const fetched = await api.getGuildScheduledEvents(guildId);
      setEvents(fetched);

      // Seed interest state from the list payload, then refine with the
      // authoritative per-event "who's interested" endpoint.
      const seeded: Record<string, InterestInfo> = {};
      for (const ev of fetched) {
        seeded[ev.id] = { interested: false, count: ev.interested_count ?? 0 };
      }
      setInterest(seeded);

      const results = await Promise.allSettled(
        fetched.map(async (ev) => ({ id: ev.id, data: await api.getScheduledEventInterested(guildId, ev.id) })),
      );
      setInterest(prev => {
        const next = { ...prev };
        for (const result of results) {
          if (result.status !== 'fulfilled') continue;
          const { id, data } = result.value;
          next[id] = {
            interested: currentUserId != null && data.user_ids.includes(currentUserId),
            count: data.count,
          };
        }
        return next;
      });
    } catch {
      setEvents([]);
      setInterest({});
    } finally {
      setLoading(false);
    }
  }, [guildId, currentUserId]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleDelete = async (id: string) => {
    try {
      await api.deleteGuildScheduledEvent(guildId, id);
      setEvents(prev => prev.filter(e => e.id !== id));
    } catch { /* ignore */ }
  };

  const handleToggleInterest = async (eventId: string) => {
    const current = interest[eventId] ?? { interested: false, count: 0 };
    const optimistic: InterestInfo = current.interested
      ? { interested: false, count: Math.max(0, current.count - 1) }
      : { interested: true, count: current.count + 1 };
    setInterest(prev => ({ ...prev, [eventId]: optimistic }));
    try {
      if (current.interested) {
        await api.unrsvpScheduledEvent(guildId, eventId);
      } else {
        await api.rsvpScheduledEvent(guildId, eventId);
      }
    } catch {
      setInterest(prev => ({ ...prev, [eventId]: current }));
    }
  };

  const fmt = (iso: string) => {
    const d = new Date(iso);
    return isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  };

  return createPortal(
    <div
      style={s.overlay}
      role="dialog"
      aria-modal="true"
      aria-label="Server Events"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={s.modal} data-testid="guild-events-modal">
        <div style={s.header}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Events</h2>
          <button style={s.closeBtn} onClick={onClose} aria-label="Close" type="button">×</button>
        </div>

        {loading ? (
          <div style={s.empty}>Loading events…</div>
        ) : events.length === 0 ? (
          <div style={s.empty} data-testid="events-empty">No upcoming events.</div>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, overflowY: 'auto' }} aria-label="Event list">
            {events.map(ev => {
              const info = interest[ev.id] ?? { interested: false, count: ev.interested_count ?? 0 };
              return (
                <li key={ev.id} style={s.row} data-testid="event-item">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600 }}>{ev.name}</div>
                    <div style={{ fontSize: 13, color: '#babfc6' }}>
                      {fmt(ev.scheduled_start_time)} · {ENTITY_LABEL[ev.entity_type] ?? 'Event'}
                    </div>
                    {ev.description && <div style={{ fontSize: 13, color: '#babfc6', marginTop: 4 }}>{ev.description}</div>}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                    <span style={s.interestCount} data-testid="interest-count">
                      {info.count} interested
                    </span>
                    <button
                      style={info.interested ? s.interestBtnActive : s.interestBtn}
                      onClick={() => void handleToggleInterest(ev.id)}
                      aria-pressed={info.interested}
                      aria-label={info.interested ? `Remove interest from ${ev.name}` : `Mark interested in ${ev.name}`}
                      type="button"
                    >
                      {info.interested ? '✓ Interested' : 'Interested'}
                    </button>
                    <button style={s.delBtn} onClick={() => void handleDelete(ev.id)} aria-label={`Delete ${ev.name}`} type="button">
                      Delete
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <div style={s.footer}>
          <button
            style={s.createBtn}
            type="button"
            onClick={() => { onClose(); dispatch(openModal({ modal: 'createEvent', props: { guildId } })); }}
          >
            Create Event
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

const s: Record<string, React.CSSProperties> = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal: { background: '#36383d', color: '#e0e3e6', width: 440, maxWidth: '90vw', maxHeight: '80vh', borderRadius: 8, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid #1f2124' },
  footer: { padding: '12px 20px', borderTop: '1px solid #1f2124', display: 'flex', justifyContent: 'flex-end' },
  row: { display: 'flex', alignItems: 'center', gap: 12, padding: '12px 20px', borderBottom: '1px solid #26282c' },
  empty: { padding: 24, color: '#babfc6', textAlign: 'center' },
  closeBtn: { background: 'none', border: 0, color: '#babfc6', fontSize: 24, cursor: 'pointer', lineHeight: 1 },
  delBtn: { background: 'none', border: '1px solid #53555d', color: '#f23f42', borderRadius: 4, padding: '4px 10px', cursor: 'pointer', fontSize: 13 },
  createBtn: { background: '#3b82f6', color: '#fff', border: 0, borderRadius: 4, padding: '8px 16px', cursor: 'pointer', fontWeight: 600 },
  interestBtn: { background: 'none', border: '1px solid #53555d', color: '#e0e3e6', borderRadius: 4, padding: '4px 10px', cursor: 'pointer', fontSize: 13, whiteSpace: 'nowrap' },
  interestBtnActive: { background: '#3b82f6', border: '1px solid #3b82f6', color: '#fff', borderRadius: 4, padding: '4px 10px', cursor: 'pointer', fontSize: 13, whiteSpace: 'nowrap' },
  interestCount: { fontSize: 13, color: '#babfc6', whiteSpace: 'nowrap' },
};
