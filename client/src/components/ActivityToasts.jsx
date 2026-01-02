import React, { useEffect, useMemo, useRef, useState } from 'react';

/**
 * Activity toast list (max 4).
 * Server keeps the last 4 entries; the client shows them for `ttlMs` starting
 * from the moment they are received (robust even if the client clock is wrong).
 */
export default function ActivityToasts({ room }) {
  const [tick, setTick] = useState(0);

  // IMPORTANT: We intentionally do NOT rely on the server timestamp (ts) to expire entries.
  // In the real world, clients can have a misconfigured system clock which would make
  // `Date.now() > ts + ttl` immediately true, resulting in *no toasts ever showing*.
  // Instead, we start the TTL locally when we *receive* an entry.
  const receivedAtRef = useRef(new Map());

  useEffect(() => {
    const id = setInterval(() => setTick((t) => (t + 1) % 10_000), 250);
    return () => clearInterval(id);
  }, []);

  // Track when each activity entry was first seen by this client.
  useEffect(() => {
    const list = Array.isArray(room?.activity) ? room.activity : [];
    const now = Date.now();

    const keysInState = new Set();
    for (const e of list) {
      const key = e?.id || `${e?.ts ?? 0}-${e?.text ?? ''}`;
      keysInState.add(key);
      if (!receivedAtRef.current.has(key)) {
        receivedAtRef.current.set(key, now);
      }
    }

    // Clean up keys that disappeared from room state.
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

  if (!entries.length) return null;

  return (
    <div
      style={{
        position: 'absolute',
        left: 18,
        bottom: 18,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        zIndex: 50,
        pointerEvents: 'none',
        maxWidth: '52%',
      }}
      aria-label="Aktivitäten"
    >
      {entries.map((e) => (
        <div
          key={e.id || `${e.ts}-${e.text}`}
          style={{
            background: 'rgba(0,0,0,0.82)',
            color: 'white',
            padding: '10px 12px',
            borderRadius: 12,
            fontSize: 18,
            lineHeight: 1.25,
            boxShadow: '0 12px 30px rgba(0,0,0,0.18)',
            border: '1px solid rgba(255,255,255,0.12)',
            backdropFilter: 'blur(6px)',
          }}
        >
          {String(e.text ?? '')}
        </div>
      ))}
    </div>
  );
}
