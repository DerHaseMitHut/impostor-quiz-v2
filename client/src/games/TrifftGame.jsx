import React, { useMemo, useState } from 'react';
import Sprite from '../components/Sprite.jsx';
import ActivityPanel from '../components/ActivityPanel.jsx';

function statusBg(status) {
  if (status === 'correct') return 'var(--correct-bg)';
  if (status === 'wrong') return 'var(--wrong-bg)';
  // Neutral/unknown should not tint the sprite; returning null avoids the "washed out" look.
  return null;
}

function Card({ it, placement, status, lock, myId, canMove, selected, onClick, onDragStart, onDragEnd }) {
  const lockedByOther = Boolean(lock && lock.by && lock.by !== myId && lock.expiresAt > Date.now());
  const tint = statusBg(status);
  return (
    <div
      draggable={canMove && !lockedByOther}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onClick}
      style={{
        width: '100%',
        aspectRatio: '1 / 1',
        borderRadius: 14,
        border: selected ? '3px solid rgba(0,0,0,0.65)' : '1px solid rgba(0,0,0,0.12)',
        // Keep the same "full tile" correct/wrong look as Sortieren/Aufzählen.
        background: tint || '#fff',
        padding: 0,
        cursor: lockedByOther ? 'not-allowed' : 'pointer',
        opacity: lockedByOther ? 0.55 : 1,
        userSelect: 'none',
        position: 'relative',
        boxShadow: selected ? '0 0 0 2px rgba(0,0,0,0.08)' : undefined,
        overflow: 'hidden'
      }}
    >
      {/* Image fills the whole card (cropping is OK). */}
      <div style={{ position: 'absolute', inset: 0 }}>
        {it.imgUrl ? (
          <Sprite src={it.imgUrl} alt={it.name} fill fit="cover" />
        ) : (
          <div className="muted" style={{ height: '100%', display: 'grid', placeItems: 'center' }}>
            (kein Bild)
          </div>
        )}
      </div>

      {/* Status tint layer so correct/wrong is still visible over the image. */}
      {tint ? (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: tint,
            opacity: 0.35
          }}
        />
      ) : null}

      {/* Name overlay with contour for readability */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          padding: '6px 6px',
          fontWeight: 950,
          fontSize: 16,
          textAlign: 'center',
          lineHeight: 1.05,
          background: 'linear-gradient(to top, rgba(255,255,255,0.92), rgba(255,255,255,0.0))',
          color: '#111',
          textShadow:
            '-1px -1px 0 rgba(255,255,255,0.95), 1px -1px 0 rgba(255,255,255,0.95), -1px 1px 0 rgba(255,255,255,0.95), 1px 1px 0 rgba(255,255,255,0.95), 0 0 2px rgba(255,255,255,0.95)'
        }}
      >
        {it.name}
      </div>

      {lock && lock.by && lock.by !== myId && lock.expiresAt > Date.now() ? (
        <div className="badge" style={{ position: 'absolute', top: 6, right: 6, fontSize: 10 }}>
          gesperrt
        </div>
      ) : null}
    </div>
  );
}

function Zone({ title, onDrop, onDragOver, onClick, children }) {
  return (
    <div
      onDrop={onDrop}
      onDragOver={onDragOver}
      onClick={onClick}
      style={{
        border: '1px solid rgba(0,0,0,0.12)',
        borderRadius: 16,
        padding: 12,
        background: '#fff',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0
      }}
    >
      <div style={{ fontWeight: 950, fontSize: 18, marginBottom: 10 }}>{title}</div>
      <div
        className="grid"
        style={{
          gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
          gap: 12,
          alignContent: 'start',
          minHeight: 0,
          overflow: 'hidden'
        }}
      >
        {children}
      </div>
    </div>
  );
}

export default function TrifftGame({ socket, me, room, }) {
  const isHost = room.hostId === me.playerId;
  const game = room.game;

  const canMove = room.phase === 'IN_ROUND' && !room.locked;
  const markEnabled = isHost && room.locked && room.phase === 'IN_ROUND';

  const items = game.items || [];
  const placements = game.placements || {};
  const locks = game.locks || {};
  const statuses = game.statuses || {};

  const [selectedId, setSelectedId] = useState(null);
  const byZone = useMemo(() => {
    const map = { pool: [], zu: [], nicht: [] };
    for (const it of items) {
      const z = placements[it.id] || 'pool';
      (map[z] || map.pool).push(it);
    }
    return map;
  }, [items, placements]);

  const release = (itemId) => {
    socket.emit('trifft:release', { code: room.code, playerId: me.playerId, itemId }, () => {});
  };

  const reserve = (itemId, cb) => {
    if (!canMove) return cb?.({ ok: false });
    socket.emit('trifft:reserve', { code: room.code, playerId: me.playerId, itemId }, (res) => cb?.(res));
  };

  const place = (itemId, zone) => {
    socket.emit('trifft:place', { code: room.code, playerId: me.playerId, itemId, zone }, () => {});
  };

  const mark = (status) => {
    if (!selectedId) return;
    socket.emit('trifft:mark', { code: room.code, playerId: me.playerId, itemId: selectedId, status }, () => {});
    setSelectedId(null);
  };

  const deleteSelected = () => {
    if (!selectedId) return;
    if (!canMove) return;
    place(selectedId, 'pool');
    setSelectedId(null);
  };

  const selectForMove = (it) => {
    if (!canMove) return;
    const lock = locks[it.id];
    if (lock && lock.by && lock.by !== me.playerId && lock.expiresAt > Date.now()) return;

    if (selectedId === it.id) {
      setSelectedId(null);
      release(it.id);
      return;
    }
    reserve(it.id, (res) => {
      if (res?.ok) setSelectedId(it.id);
    });
  };

  const selectForMark = (it) => {
    // When locked, we only need a local selection for marking.
    if (!isHost) return;
    setSelectedId((prev) => (prev === it.id ? null : it.id));
    // (Optional cleanup) If the item is still reserved by someone, the host can release it.
    const lock = locks[it.id];
    if (lock && lock.by) release(it.id);
  };

  const clickCard = (it) => {
    if (room.phase !== 'IN_ROUND') return;
    if (room.locked) return selectForMark(it);
    return selectForMove(it);
  };

  const clickZone = (zone) => {
    if (!canMove) {
      // allow deselect without moving anything
      if (selectedId) setSelectedId(null);
      return;
    }
    if (!selectedId) return;
    place(selectedId, zone);
    setSelectedId(null);
  };

  const onDropZone = (zone) => (e) => {
    e.preventDefault();
    if (!canMove) return;
    const itemId = e.dataTransfer.getData('text/plain');
    if (!itemId) return;
    place(itemId, zone);
    setSelectedId(null);
  };

  const onDragOver = (e) => {
    if (!canMove) return;
    e.preventDefault();
  };

  return (
    <div
      className="grid"
      style={{
        gap: 12,
        height: '100%',
        gridTemplateRows: 'auto minmax(0, 1fr) minmax(170px, 240px)',
        minHeight: 0
      }}
    >
      {/* Thesis + activity feed */}
      <div
        style={{ border: '1px solid rgba(0,0,0,0.12)', borderRadius: 16, padding: 12, background: '#fff' }}
      >
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, alignItems: 'stretch' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 950, marginBottom: 6 }}>These</div>
            <div style={{ fontSize: 18, lineHeight: 1.35 }}>{game.thesis || <span className="muted">(keine These)</span>}</div>

            {isHost ? (
              <div style={{ marginTop: 10, display: 'flex', justifyContent: 'flex-end' }}>
                <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                  <button disabled={!markEnabled || !selectedId} onClick={() => mark('correct')}>Richtig</button>
                  <button disabled={!markEnabled || !selectedId} onClick={() => mark('wrong')}>Falsch</button>
                  <button disabled={!markEnabled || !selectedId} onClick={() => mark('neutral')}>Neutral</button>
                  <button disabled={!canMove || !selectedId} onClick={deleteSelected}>Löschen</button>
                </div>
              </div>
            ) : null}
          </div>

          <div style={{ borderLeft: '1px solid rgba(0,0,0,0.10)', paddingLeft: 12, minWidth: 0 }}>
            <ActivityPanel room={room} />
          </div>
        </div>
      </div>


      {/* Zones */}
      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12, minHeight: 0 }}>
        <Zone title="Trifft zu" onDrop={onDropZone('zu')} onDragOver={onDragOver} onClick={() => clickZone('zu')}>
          {byZone.zu.map((it) => (
            <Card
              key={it.id}
              it={it}
              placement="zu"
              status={statuses[it.id]}
              lock={locks[it.id]}
              myId={me.playerId}
              canMove={canMove}
              selected={selectedId === it.id}
              onClick={(e) => {
                e.stopPropagation();
                // Before lock: clicking a placed card returns it to the pool.
                if (canMove) {
                  reserve(it.id, (res) => {
                    if (res?.ok) {
                      place(it.id, 'pool');
                      setSelectedId(null);
                    }
                  });
                  return;
                }
                // After lock: select for marking.
                clickCard(it);
              }}
              onDragStart={(e) => {
                if (!canMove) return;
                e.dataTransfer.setData('text/plain', it.id);
                reserve(it.id, (res) => {
                  if (!res?.ok) e.preventDefault();
                });
              }}
              onDragEnd={() => release(it.id)}
            />
          ))}
        </Zone>

        <Zone title="Trifft nicht zu" onDrop={onDropZone('nicht')} onDragOver={onDragOver} onClick={() => clickZone('nicht')}>
          {byZone.nicht.map((it) => (
            <Card
              key={it.id}
              it={it}
              placement="nicht"
              status={statuses[it.id]}
              lock={locks[it.id]}
              myId={me.playerId}
              canMove={canMove}
              selected={selectedId === it.id}
              onClick={(e) => {
                e.stopPropagation();
                if (canMove) {
                  reserve(it.id, (res) => {
                    if (res?.ok) {
                      place(it.id, 'pool');
                      setSelectedId(null);
                    }
                  });
                  return;
                }
                clickCard(it);
              }}
              onDragStart={(e) => {
                if (!canMove) return;
                e.dataTransfer.setData('text/plain', it.id);
                reserve(it.id, (res) => {
                  if (!res?.ok) e.preventDefault();
                });
              }}
              onDragEnd={() => release(it.id)}
            />
          ))}
        </Zone>
      </div>

      {/* Pool */}
      <div
        style={{
          border: '1px solid rgba(0,0,0,0.12)',
          borderRadius: 16,
          padding: 12,
          background: '#fff',
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0
        }}
        onClick={() => {
          // clicking empty area clears selection
          if (canMove && selectedId) release(selectedId);
          setSelectedId(null);
        }}
      >
        <div style={{ fontWeight: 950, marginBottom: 10, fontSize: 16 }}>Pokémon (Pool)</div>
        <div
          className="grid"
          style={{
            /* Keep 10 in a single row. If the stage gets too narrow, allow horizontal scroll instead of clipping. */
            gridTemplateColumns: 'repeat(10, minmax(92px, 1fr))',
            gap: 10,
            alignContent: 'start',
            minHeight: 0,
            overflowX: 'auto',
            overflowY: 'hidden',
            paddingBottom: 6
          }}
        >
          {byZone.pool.map((it) => (
            <Card
              key={it.id}
              it={it}
              placement="pool"
              status={statuses[it.id]}
              lock={locks[it.id]}
              myId={me.playerId}
              canMove={canMove}
              selected={selectedId === it.id}
              onClick={(e) => {
                e.stopPropagation();
                clickCard(it);
              }}
              onDragStart={(e) => {
                if (!canMove) return;
                e.dataTransfer.setData('text/plain', it.id);
                reserve(it.id, (res) => {
                  if (!res?.ok) e.preventDefault();
                });
              }}
              onDragEnd={() => release(it.id)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
