import React, { useMemo, useState } from 'react';
import ActivityPanel from '../components/ActivityPanel.jsx';

function norm(s) {
  return String(s || '').trim().toLowerCase();
}

function cellBg(status) {
  // Match the strong, consistent "correct / wrong" look used in other games (Trifft/Sortieren).
  if (status === 'correct') return 'var(--correct-bg)';
  if (status === 'wrong') return 'var(--wrong-bg)';
  return '#fff';
}

function cellBorder(status) {
  if (status === 'correct') return 'rgba(34,197,94,0.85)';
  if (status === 'wrong') return 'rgba(239,68,68,0.85)';
  return 'rgba(0,0,0,0.14)';
}

export default function AufzaehlenGame({ socket, me, room, }) {
  const isHost = room.hostId === me.playerId;
  const game = room.game;
  const [text, setText] = useState('');
  const [selected, setSelected] = useState(null); // index

  const dupSet = useMemo(() => {
    const counts = new Map();
    for (const c of game.cells) {
      if (!c.text) continue;
      const k = norm(c.text);
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    const d = new Set();
    for (const [k, v] of counts.entries()) {
      if (v >= 2) d.add(k);
    }
    return d;
  }, [game.cells]);

  const canInteract = room.phase === 'IN_ROUND' && !room.locked;

  const add = () => {
    const t = text.trim();
    if (!t) return;
    socket.emit('aufzaehlen:add', { code: room.code, playerId: me.playerId, text: t }, (res) => {
      if (res?.ok) setText('');
    });
  };

  const del = (index) => {
    socket.emit('aufzaehlen:delete', { code: room.code, playerId: me.playerId, index }, () => {});
  };

  const clearAll = () => {
    socket.emit('aufzaehlen:clearAll', { code: room.code, playerId: me.playerId }, () => {});
    setSelected(null);
  };

  const mark = (status) => {
    if (selected === null) return;
    socket.emit('aufzaehlen:mark', { code: room.code, playerId: me.playerId, index: selected, status }, () => {});
    // avoid "stuck" selection during moderation
    setSelected(null);
  };

  const deleteSelected = () => {
    if (selected === null) return;
    del(selected);
    setSelected(null);
  };

  const onCellClick = (idx) => {
    const c = game.cells[idx];
    // Host can deselect by clicking any empty cell.
    if (!c.text) {
      if (isHost) setSelected(null);
      return;
    }

    if (isHost) {
      setSelected((prev) => (prev === idx ? null : idx));
      return;
    }

    // players: delete only own (server enforces)
    if (canInteract) del(idx);
  };
  return (
    <div
      className="grid"
      style={{
        height: '100%',
        gridTemplateRows: 'auto 1fr auto',
        gap: 12,
        alignContent: 'start'
      }}
    >
      <div
        onClick={(e) => {
          if (!isHost) return;
          // Clicking the question/feed area should allow deselection without triggering any other action.
          if (e.target.closest?.('button') || e.target.closest?.('input')) return;
          setSelected(null);
        }}
        style={{ border: '1px solid rgba(0,0,0,0.12)', borderRadius: 16, padding: 12, background: '#fff' }}
      >
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, alignItems: 'stretch' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 900, marginBottom: 6 }}>Frage</div>
            <div style={{ fontSize: 18, lineHeight: 1.35 }}>
              {game.question || <span className="muted">(keine Frage)</span>}
            </div>
          </div>

          <div style={{ borderLeft: '1px solid rgba(0,0,0,0.10)', paddingLeft: 12, minWidth: 0 }}>
            <ActivityPanel room={room} />
          </div>
        </div>
      </div>

      <div
        className="grid"
        onClick={() => {
          if (isHost) setSelected(null);
        }}
        style={{
          gridTemplateColumns: `repeat(${game.cols}, minmax(0, 1fr))`,
          gap: 8,
          alignContent: 'start',
          minHeight: 0,
          overflow: 'hidden'
        }}
      >
        {game.cells.map((c, idx) => {
          const isDup = c.text && dupSet.has(norm(c.text));
          const isSelected = selected === idx;
          return (
            <div
              key={idx}
              data-cell="1"
              onClick={(e) => {
                e.stopPropagation();
                onCellClick(idx);
              }}
              style={{
                position: 'relative',
                minHeight: 88,
                padding: 10,
                borderRadius: 12,
                border: isSelected ? '2px solid rgba(0,0,0,0.65)' : `2px solid ${cellBorder(c.status)}`,
                background: cellBg(c.status),
                boxShadow: isSelected ? '0 0 0 2px rgba(0,0,0,0.10)' : undefined,
                cursor: c.text ? (canInteract || isHost ? 'pointer' : 'default') : 'default',
                userSelect: 'none',
                overflow: 'hidden',
                display: 'grid',
                placeItems: 'center',
                textAlign: 'center'
              }}
              title={c.text ? `Owner: ${c.ownerId || '-'} | Status: ${c.status}` : ''}
            >
              {c.text ? (
                <div style={{ fontWeight: 950, lineHeight: 1.1, fontSize: 24 }}>{c.text}</div>
              ) : (
                <div className="muted" style={{ fontSize: 14 }}>—</div>
              )}

              
              {/* no extra badges: keep it consistent with other games (full red/green tile) */}


              {isDup ? (
                <div
                  style={{
                    position: 'absolute',
                    right: 8,
                    top: 8,
                    width: 18,
                    height: 18,
                    borderRadius: 9999,
                    display: 'grid',
                    placeItems: 'center',
                    background: 'rgba(245,158,11,0.20)',
                    border: '1px solid rgba(0,0,0,0.12)',
                    fontWeight: 900,
                    fontSize: 12
                  }}
                  title="Duplikat"
                >
                  !
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <div
        onClick={(e) => {
          if (!isHost) return;
          if (e.target.closest?.('button') || e.target.closest?.('input')) return;
          setSelected(null);
        }}
        style={{
          border: '1px solid rgba(0,0,0,0.12)',
          borderRadius: 16,
          padding: 12,
          background: '#fff',
          display: 'grid',
          gap: 10,
          alignItems: 'center'
        }}
      >
        {!isHost ? (
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Antwort eingeben..."
            disabled={!canInteract}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add();
              }
            }}
          />
        ) : (
          <>
            <div
              style={{
                display: 'flex',
                gap: 10,
                flexWrap: 'wrap',
                justifyContent: 'center'
              }}
            >
              <button disabled={selected === null} onClick={() => mark('correct')}>Grün</button>
              <button disabled={selected === null} onClick={() => mark('wrong')}>Rot</button>
              <button disabled={selected === null} onClick={() => mark('neutral')}>Neutral</button>
              <button disabled={selected === null || !canInteract} onClick={deleteSelected}>Löschen</button>
              <button onClick={clearAll} disabled={room.phase !== 'IN_ROUND'} title="Alles leeren">Alle löschen</button>
            </div>
            <div className="muted" style={{ fontSize: 12, textAlign: 'center' }}>
              {selected !== null ? (
                <span>Ausgewählt: {game.cells[selected]?.text || '(leer)'}</span>
              ) : (
                <span>Keine Zelle ausgewählt</span>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
