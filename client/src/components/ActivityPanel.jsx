import React, { useEffect, useMemo, useRef, useState } from 'react';

/**
 * Activity panel (max 4). Shows entries for a short time (default 5s) starting
 * from when the client first sees them (robust even if client clock is wrong).
 */
export default function ActivityPanel({ room, title = 'Aktivität' }) {
  const [tick, setTick] = useState(0);
  const receivedAtRef = useRef(new Map());

  useEffect(() => {
    const id = setInterval(() => setTick((t) => (t + 1) % 10_000), 250);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const list = Array.isArray(room?.activity) ? room.activity : [];
    const now = Date.now();

    const keysInState = new Set();
    for (const e of list) {
      const key = e?.id || `${e?.ts ?? 0}-${e?.text ?? ''}`;
      keysInState.add(key);
      if (!receivedAtRef.current.has(key)) receivedAtRef.current.set(key, now);
    }

    for (const k of receivedAtRef.current.keys()) {
      if (!keysInState.has(k)) receivedAtRef.current.delete(k);
    }
  }, [room?.activity]);

  const entries = useMemo(() => {
    const list = Array.isArray(room?.activity) ? room.activity : [];
    const now = Date.now();
    return list.filter((e) => {
      const key = e?.id || `${e?.ts ?? 0}-${e?.text ?? ''}`;
      const receivedAt = Number(receivedAtRef.current.get(key) ?? now);
      const ttl = Number(e?.ttlMs ?? 5000);
      return ttl > 0 && now < receivedAt + ttl;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room?.activity, tick]);

  // Keep a stable footprint so the panel does not shift surrounding UI.
  // Server keeps max 4; we render a 2x2 grid (side-by-side) regardless of count.
  const slots = useMemo(() => {
    const s = new Array(4).fill(null);
    for (let i = 0; i < 4; i++) s[i] = entries[i] || null;
    return s;
  }, [entries]);

  return (
    <div
      style={{
        height: 112,
        minHeight: 112,
        maxHeight: 112,
        display: 'flex',
        flexDirection: 'column'
      }}
      aria-label="Aktivitätslog"
    >
      <div style={{ fontWeight: 950, marginBottom: 6 }}>{title}</div>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'grid',
          gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
          gap: 6,
          overflow: 'hidden',
          alignContent: 'start'
        }}
      >
        {slots.map((e, idx) => {
          if (!e) {
            if (!entries.length && idx === 0) {
              return (
                <div
                  key={`empty-${idx}`}
                  className="muted"
                  style={{
                    fontSize: 14,
                    lineHeight: 1.25,
                    padding: '6px 8px',
                    borderRadius: 10,
                    border: '1px solid rgba(0,0,0,0.06)',
                    background: 'rgba(0,0,0,0.02)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}
                >
                  (keine Aktionen)
                </div>
              );
            }
            return (
              <div
                key={`empty-${idx}`}
                style={{
                  padding: '6px 8px',
                  borderRadius: 10,
                  border: '1px solid transparent',
                  background: 'transparent'
                }}
              />
            );
          }

          return (
            <div
              key={e.id || `${e.ts}-${e.text}`}
              style={{
                fontSize: 14,
                lineHeight: 1.25,
                padding: '6px 8px',
                borderRadius: 10,
                background: 'rgba(0,0,0,0.06)',
                border: '1px solid rgba(0,0,0,0.08)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }}
              title={String(e.text ?? '')}
            >
              {String(e.text ?? '')}
            </div>
          );
        })}
      </div>
    </div>
  );
}
