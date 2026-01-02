import React, { useMemo, useState } from 'react';

export default function JoinCard({ defaultName, status, onCreate, onJoin }) {
  const [name, setName] = useState(defaultName || '');
  const [code, setCode] = useState('');

  const valid = useMemo(() => name.trim().length > 0, [name]);

  return (
    <div className="card" style={{ maxWidth: 560, margin: '0 auto' }}>
      <h2 style={{ margin: 0 }}>Beitreten</h2>
      <p className="muted" style={{ marginTop: 6 }}>
        Erstelle einen Room (Spielleiter) oder trete mit Code bei.
      </p>

      <div className="hr" />

      <div className="grid" style={{ gridTemplateColumns: '1fr', gap: 10 }}>
        <label>
          <div className="pill" style={{ marginBottom: 6 }}>Dein Name</div>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />
        </label>
        <label>
          <div className="pill" style={{ marginBottom: 6 }}>Room-Code</div>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="z.B. 9KQ2A"
          />
        </label>
      </div>

      <div className="row" style={{ marginTop: 12, justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <button disabled={!valid} onClick={() => onCreate(name.trim())}>
          Room erstellen (Host)
        </button>
        <button disabled={!valid || code.trim().length < 4} onClick={() => onJoin(code.trim(), name.trim())}>
          Beitreten
        </button>
      </div>

      {status ? <p className="muted" style={{ marginTop: 12 }}>{status}</p> : null}

      <div className="hr" />
      <div className="muted" style={{ fontSize: 13 }}>
        Tipp: Spieler bleiben zwischen Runden verbunden. Der Host startet einfach die nächste Runde.
      </div>
    </div>
  );
}
