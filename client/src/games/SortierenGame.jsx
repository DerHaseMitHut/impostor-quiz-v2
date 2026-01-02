import React, { useMemo, useState } from 'react';
import Sprite from '../components/Sprite.jsx';
import ActivityPanel from '../components/ActivityPanel.jsx';

function slotBg(ok) {
  if (ok === true) return 'var(--correct-bg)';
  if (ok === false) return 'var(--wrong-bg)';
  return 'var(--neutral-bg)';
}

function Item({ it, lockedByOther, selected, onClick, onDragStart, onDragEnd }) {
  return (
    <div
      draggable={!lockedByOther}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onClick}
      style={{
        width: 120,
        height: 128,
        borderRadius: 14,
        border: selected ? '3px solid rgba(0,0,0,0.65)' : '1px solid rgba(0,0,0,0.12)',
        padding: 0,
        background: 'white',
        cursor: lockedByOther ? 'not-allowed' : 'pointer',
        opacity: lockedByOther ? 0.55 : 1,
        position: 'relative',
        userSelect: 'none',
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

      {/* Name overlay with contour for readability */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          padding: '6px 8px',
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
    </div>
  );
}

export default function SortierenGame({ socket, me, room, }) {
  const game = room.game;
  const canInteract = room.phase === 'IN_ROUND' && !room.locked;

  const items = game.items || [];
  const locks = game.locks || {};

  const [selectedId, setSelectedId] = useState(null);
  const slotItemById = useMemo(() => {
    const map = new Map();
    for (const it of items) map.set(it.id, it);
    return map;
  }, [items]);

  const slotted = useMemo(() => new Set(game.slots.filter(Boolean)), [game.slots]);
  const pool = useMemo(() => {
    const order = Array.isArray(game.poolOrder) && game.poolOrder.length ? game.poolOrder : items.map((it) => it.id);
    const byId = new Map(items.map((it) => [it.id, it]));
    return order
      .map((id) => byId.get(id))
      .filter(Boolean)
      .filter((it) => !slotted.has(it.id));
  }, [items, slotted, game.poolOrder]);

  const reserve = (itemId, cb) => {
    if (!canInteract) return;
    socket.emit('sort:reserve', { code: room.code, playerId: me.playerId, itemId }, (res) => cb?.(res));
  };

  const release = (itemId) => {
    socket.emit('sort:release', { code: room.code, playerId: me.playerId, itemId }, () => {});
  };

  const place = (itemId, slotIndex) => {
    socket.emit('sort:place', { code: room.code, playerId: me.playerId, itemId, slotIndex }, () => {});
    setSelectedId(null);
  };

  const clickItem = (it) => {
    if (!canInteract) return;
    const lock = locks[it.id];
    if (lock && lock.by && lock.by !== me.playerId) return;

    if (selectedId === it.id) {
      setSelectedId(null);
      release(it.id);
      return;
    }
    reserve(it.id, (res) => {
      if (res?.ok) setSelectedId(it.id);
    });
  };

  const onDropSlot = (slotIndex) => (e) => {
    e.preventDefault();
    const itemId = e.dataTransfer.getData('text/plain');
    if (!itemId) return;
    if (!canInteract) return;
    place(itemId, slotIndex);
  };

  const revealOk = room.phase === 'REVEAL' ? (game.reveal?.correctness || []) : [];

  const totalCount = Math.max(1, items.length);
  const maxCols = 10;
  const cols = Math.min(maxCols, totalCount);
  const rows = Math.ceil(totalCount / cols);
  const poolMinHeight = rows * 128 + Math.max(0, rows - 1) * 12;

  return (
    <div className="grid" style={{ gap: 12, height: '100%', gridTemplateRows: 'auto auto 1fr', minHeight: 0 }}>

      {/* Pool */}
      <div style={{ border: '1px solid rgba(0,0,0,0.12)', borderRadius: 16, padding: 12, background: '#fff' }}>
        <div style={{ fontWeight: 950, marginBottom: 10, fontSize: 14 }}>Pool</div>
        <div
          className="grid"
          style={{
            gridTemplateColumns: `repeat(${cols}, minmax(120px, 1fr))`,
            gap: 12,
            alignContent: 'start',
            minHeight: poolMinHeight
          }}
        >
          {pool.map((it) => {
            const lock = locks[it.id];
            const lockedByOther = Boolean(lock && lock.by && lock.by !== me.playerId);
            return (
              <Item
                key={it.id}
                it={it}
                lockedByOther={lockedByOther}
                selected={selectedId === it.id}
                onClick={() => clickItem(it)}
                onDragStart={(e) => {
                  if (!canInteract) return;
                  e.dataTransfer.setData('text/plain', it.id);
                  reserve(it.id, (res) => {
                    if (!res?.ok) e.preventDefault();
                  });
                }}
                onDragEnd={() => release(it.id)}
              />
            );
          })}
        </div>
      </div>

      {/* Rule must be between Pool and Antwort */}
      <div style={{ border: '1px solid rgba(0,0,0,0.12)', borderRadius: 16, padding: 12, background: '#fff' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, alignItems: 'stretch' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 950, marginBottom: 8 }}>Sortier-Regel</div>
            <div className="row" style={{ justifyContent: 'center', gap: 16, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 28, fontWeight: 950 }}>{game.axisLeftLabel || 'links'}</span>
              <span style={{ fontSize: 32, fontWeight: 950, opacity: 0.7 }}>→</span>
              <span style={{ fontSize: 28, fontWeight: 950 }}>{game.axisRightLabel || 'rechts'}</span>
            </div>
          </div>

          <div style={{ borderLeft: '1px solid rgba(0,0,0,0.10)', paddingLeft: 12, minWidth: 0 }}>
            <ActivityPanel room={room} />
          </div>
        </div>
      </div>

      {/* Board area (Antwort + optional Lösung). This keeps the layout stable and uses free space for the Lösung on reveal. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0 }}>
        {/* Antwort */}
        <div style={{ border: '1px solid rgba(0,0,0,0.12)', borderRadius: 16, padding: 12, background: '#fff' }}>
          <div style={{ fontWeight: 950, marginBottom: 10, fontSize: 14 }}>Antwort</div>
          <div
            className="grid"
            style={{
              gridTemplateColumns: `repeat(${cols}, minmax(120px, 1fr))`,
              gap: 10,
              alignContent: 'start'
            }}
          >
            {game.slots.map((id, idx) => {
              const ok = room.phase === 'REVEAL' ? Boolean(revealOk[idx]) : null;
              const it = id ? slotItemById.get(id) : null;
              return (
                <div
                  key={idx}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={onDropSlot(idx)}
                  onClick={() => {
                    if (!canInteract) return;
                    if (selectedId) {
                      place(selectedId, idx);
                      return;
                    }
                    // click to remove
                    if (id) {
                      reserve(id, (res) => {
                        if (res?.ok) place(id, null);
                      });
                    }
                  }}
                  style={{
                    borderRadius: 14,
                    border: '1px solid rgba(0,0,0,0.12)',
                    background: slotBg(ok),
                    // Make Antwort slots taller so the stage is filled better.
                    minHeight: 210,
                    padding: 0,
                    position: 'relative',
                    overflow: 'hidden',
                    cursor: canInteract ? 'pointer' : 'default',
                    userSelect: 'none'
                  }}
                >
                  {it ? (
                    <>
                      {/* Image fills the slot (cropping is OK). */}
                      <div style={{ position: 'absolute', inset: 0 }}>
                        {it.imgUrl ? (
                          <Sprite src={it.imgUrl} alt={it.name} fill fit="cover" />
                        ) : (
                          <div className="muted" style={{ height: '100%', display: 'grid', placeItems: 'center' }}>
                            (kein Bild)
                          </div>
                        )}
                      </div>

                      {/* On reveal, tint the chosen slot green/red like other categories. */}
                      {room.phase === 'REVEAL' && (ok === true || ok === false) ? (
                        <div
                          style={{
                            position: 'absolute',
                            inset: 0,
                            background: slotBg(ok),
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
                          padding: '6px 8px',
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
                    </>
                  ) : (
                    <div className="muted" style={{ height: '100%', display: 'grid', placeItems: 'center' }}>
                      (leer)
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Lösung */}
        {room.phase === 'REVEAL' ? (
          <div style={{ border: '1px solid rgba(0,0,0,0.12)', borderRadius: 16, padding: 12, background: '#fff', flex: 1, minHeight: 0 }}>
            <div style={{ fontWeight: 950, marginBottom: 10, fontSize: 14 }}>Lösung</div>
            <div
              className="grid"
              style={{
                gridTemplateColumns: `repeat(${cols}, minmax(120px, 1fr))`,
                gap: 10,
                alignContent: 'start'
              }}
            >
              {game.solutionOrder.map((id, idx) => {
                const it = slotItemById.get(id);
                return (
                  <div
                    key={idx}
                    style={{
                      borderRadius: 14,
                      border: '1px solid rgba(0,0,0,0.12)',
                      background: 'rgba(0,0,0,0.02)',
                      // Make Lösung slots taller so the stage is filled better.
                      minHeight: 210,
                      padding: 0,
                      position: 'relative',
                      overflow: 'hidden'
                    }}
                  >
                    {it ? (
                      <>
                        <div style={{ position: 'absolute', inset: 0 }}>
                          {it.imgUrl ? (
                            <Sprite src={it.imgUrl} alt={it.name} fill fit="cover" />
                          ) : (
                            <div className="muted" style={{ height: '100%', display: 'grid', placeItems: 'center' }}>
                              (kein Bild)
                            </div>
                          )}
                        </div>

                        <div
                          style={{
                            position: 'absolute',
                            left: 0,
                            right: 0,
                            bottom: 0,
                            padding: '6px 8px',
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
                      </>
                    ) : (
                      <div className="muted">{id}</div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
