import React from 'react';

export default function PlayerList({ players }) {
  return (
    <div className="grid" style={{ gap: 8 }}>
      {players?.length ? (
        players.map((p) => (
          <div key={p.id} className="row" style={{ justifyContent: 'space-between' }}>
            <div className="row" style={{ gap: 8 }}>
              <span className="badge">{p.isHost ? 'Host' : 'Spieler'}</span>
              <span style={{ fontWeight: 700 }}>{p.name}</span>
            </div>
            <span className="muted" style={{ fontSize: 12 }}>{p.connected ? 'online' : 'offline'}</span>
          </div>
        ))
      ) : (
        <div className="muted">Keine Spieler</div>
      )}
    </div>
  );
}
