import React, { useEffect, useMemo, useRef, useState } from 'react';
import Modal from '../components/Modal.jsx';
import { resolveAsset } from '../socket';

function PokemonCard({ p, border, label, fill, highlighted, dimmed, onClick, canClick, width = 140, height = 150 }) {
  const resolvedImg = p.imgUrl ? resolveAsset(p.imgUrl) : '';

  return (
    <div
      onClick={canClick ? onClick : undefined}
      style={{
        width,
        height,
        borderRadius: 16,
        border,
        background: fill || 'white',
        padding: 0,
        cursor: canClick ? 'pointer' : 'default',
        userSelect: 'none',
        opacity: dimmed ? 0.35 : 1,
        boxShadow: highlighted ? '0 0 0 4px rgba(0,0,0,0.08)' : 'none',
        position: 'relative',
        overflow: 'hidden'
      }}
    >
      <div style={{ position: 'absolute', inset: 0 }}>
        {resolvedImg ? (
          <img
            src={resolvedImg}
            alt={p.name}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              imageRendering: 'auto'
            }}
          />
        ) : (
          <div className="muted" style={{ height: '100%', display: 'grid', placeItems: 'center' }}>
            (kein Bild)
          </div>
        )}
      </div>

      {/* If this card should be shown as correct/wrong, tint the whole tile (same style as Sortieren/Aufzählen). */}
      {fill ? (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: fill,
            opacity: 0.35
          }}
        />
      ) : null}

      {/* Name overlay with outline for readability */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          padding: '6px 8px',
          textAlign: 'center',
          fontWeight: 950,
          fontSize: 16,
          lineHeight: 1.05,
          color: '#111',
          background: 'linear-gradient(to top, rgba(255,255,255,0.92), rgba(255,255,255,0.0))',
          textShadow:
            '-1px -1px 0 rgba(255,255,255,0.95), 1px -1px 0 rgba(255,255,255,0.95), -1px 1px 0 rgba(255,255,255,0.95), 1px 1px 0 rgba(255,255,255,0.95), 0 0 2px rgba(255,255,255,0.95)'
        }}
      >
        {p.name}
      </div>
      {label ? (
        <div
          style={{
            position: 'absolute',
            top: 8,
            left: 8,
            fontSize: 11,
            fontWeight: 950,
            padding: '4px 6px',
            borderRadius: 999,
            background: 'rgba(0,0,0,0.10)',
            backdropFilter: 'blur(4px)'
          }}
        >
          {label}
        </div>
      ) : null}
    </div>
  );
}

function FactsList({ factsText, canInteract }) {
  return (
    <div
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
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontWeight: 950, fontSize: 18 }}>Fakten</div>
        {!canInteract ? <span className="badge">LOCK</span> : null}
      </div>
      <div className="hr" />
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <div className="grid" style={{ gap: 8 }}>
          {factsText.length ? (
            factsText.map((t, idx) => (
              <div key={idx} style={{ border: '1px solid rgba(0,0,0,0.10)', borderRadius: 12, padding: '12px 14px' }}>
                <div style={{ fontWeight: 900, fontSize: 16, opacity: 0.7, marginBottom: 6 }}>#{idx + 1}</div>
                <div style={{ fontSize: 22, fontWeight: 900, lineHeight: 1.25 }}>{t}</div>
              </div>
            ))
          ) : (
            <div className="muted">(keine Fakten)</div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function FaktenGame({ socket, me, room }) {
  const game = room.game;
  const meIsHost = room.hostId === me.playerId;
  const meIsSaboteur = game.saboteurId && game.saboteurId === me.playerId;
  const canInteract = room.phase === 'IN_ROUND' && !room.locked;

  // Host should be able to see facts during sabotage without getting live updates.
  const prevStageRef = useRef(null);
  const [hostFactsSnapshot, setHostFactsSnapshot] = useState(null);

  useEffect(() => {
    const prev = prevStageRef.current;
    prevStageRef.current = game.stage;
    if (!meIsHost) {
      setHostFactsSnapshot(null);
      return;
    }
    if (game.stage === 'SABOTAGE' && prev !== 'SABOTAGE') {
      const snapshot = Array.isArray(game.facts) ? game.facts.map((f) => ({ ...f })) : [];
      setHostFactsSnapshot(snapshot);
    }
    if (game.stage !== 'SABOTAGE') {
      setHostFactsSnapshot(null);
    }
  }, [meIsHost, game.stage, game.facts]);

  const players = room.players || [];
  const playersById = useMemo(() => {
    const m = new Map();
    for (const p of players) m.set(p.id, p);
    return m;
  }, [players]);

  // ----- Host: pick saboteur -----
  const [picked, setPicked] = useState(null);
  const [editModal, setEditModal] = useState(null); // { mode: 'edit'|'add', factId, initialText }
  const [editText, setEditText] = useState('');
  const [hoverFactId, setHoverFactId] = useState(null);
  // Local UI feedback for the saboteur after clicking "Fertig".
  const [saboteurLocked, setSaboteurLocked] = useState(false);

  const sabotageActionUsed = Boolean(game.sabotage?.actionUsed);

  const sabotageSummary = useMemo(() => {
    const s = game.sabotage;
    if (!s?.actionUsed) return null;
    const idx = s.detail?.index != null ? s.detail.index : '?';
    const oldText = s.detail?.oldText ? String(s.detail.oldText) : '';
    const newText = s.detail?.newText ? String(s.detail.newText) : '';
    if (s.actionType === 'delete') {
      return `Fakt ${idx} wurde gelöscht.`;
    }
    if (s.actionType === 'edit') {
      return `Fakt ${idx} wurde umgeschrieben von "${oldText}" zu "${newText}".`;
    }
    if (s.actionType === 'add') {
      return `Fakt ${idx} wurde hinzugefügt: "${newText}".`;
    }
    return 'Es wurde sabotiert.';
  }, [game.sabotage]);

  useEffect(() => {
    // Keep local feedback in sync with server state.
    if (!meIsSaboteur) {
      setSaboteurLocked(false);
      return;
    }
    setSaboteurLocked(Boolean(game.saboteurReady));
  }, [meIsSaboteur, game.saboteurReady]);

  const sabotageFactsForHover = useMemo(() => {
    if (game.stage !== 'SABOTAGE') return [];
    // Host gets snapshot (no live updates), saboteur sees the current list.
    if (meIsHost && !meIsSaboteur) return Array.isArray(hostFactsSnapshot) ? hostFactsSnapshot : [];
    return Array.isArray(game.facts) ? game.facts : [];
  }, [game.stage, meIsHost, meIsSaboteur, hostFactsSnapshot, game.facts]);

  const hoverApplies = useMemo(() => {
    if (!hoverFactId) return new Set();
    const f = sabotageFactsForHover.find((x) => x.id === hoverFactId);
    const arr = Array.isArray(f?.appliesToPokemonIds) ? f.appliesToPokemonIds : null;
    return new Set(arr || []);
  }, [sabotageFactsForHover, hoverFactId]);

  const selectSaboteur = () => {
    if (!picked) return;
    socket.emit('fakten:selectSaboteur', { code: room.code, playerId: me.playerId, saboteurId: picked }, () => {});
  };

  const openEdit = (factId, initial) => {
    setEditModal({ mode: 'edit', factId, initialText: initial });
    setEditText(initial || '');
  };

  const openAdd = () => {
    setEditModal({ mode: 'add', factId: null, initialText: '' });
    setEditText('');
  };

  const submitEdit = () => {
    if (!editModal) return;
    if (editModal.mode === 'edit') {
      socket.emit(
        'fakten:sabotage',
        { code: room.code, playerId: me.playerId, actionType: 'edit', targetFactId: editModal.factId, text: editText },
        () => {}
      );
    }
    if (editModal.mode === 'add') {
      socket.emit('fakten:sabotage', { code: room.code, playerId: me.playerId, actionType: 'add', text: editText }, () => {});
    }
    setEditModal(null);
  };

  const doDelete = (factId) => {
    if (!confirm('Diesen Fakt wirklich löschen?')) return;
    socket.emit('fakten:sabotage', { code: room.code, playerId: me.playerId, actionType: 'delete', targetFactId: factId }, () => {});
  };

  const doUndo = () => {
    setSaboteurLocked(false);
    socket.emit('fakten:undo', { code: room.code, playerId: me.playerId }, () => {});
  };

  const doHostUndo = () => {
    if (!confirm('Sabotage rückgängig machen? Der Saboteur kann dann erneut eine Aktion ausführen.')) return;
    socket.emit('fakten:hostUndo', { code: room.code, playerId: me.playerId }, () => {});
  };
  const doReady = () => {
    // Immediate feedback (saboteur can't ask the host).
    setSaboteurLocked(true);
    socket.emit('fakten:ready', { code: room.code, playerId: me.playerId }, () => {});
  };
  const doRelease = () => socket.emit('fakten:release', { code: room.code, playerId: me.playerId }, () => {});

  const doPick = (pokemonId) => {
    socket.emit('fakten:pick', { code: room.code, playerId: me.playerId, pokemonId }, () => {});
  };

  // ----- Rendering helpers -----
  const solutionId = game.solutionPokemonId;
  const selectionId = game.teamPickPokemonId;

  const borderFor = (pokemonId) => {
    const base = '1px solid rgba(0,0,0,0.12)';

    if (room.phase === 'REVEAL') {
      const isSolution = solutionId && pokemonId === solutionId;
      const isSelected = selectionId && pokemonId === selectionId;
      if (isSelected && isSolution) return '4px solid rgba(0,160,90,0.85)';
      if (isSelected && !isSolution) return '4px solid rgba(200,40,40,0.85)';
      if (!isSelected && isSolution) return '4px solid rgba(240,190,40,0.95)';
      return base;
    }

    if (game.stage === 'SABOTAGE' && (meIsSaboteur || meIsHost)) {
      if (solutionId && pokemonId === solutionId) return '4px solid rgba(0,160,90,0.85)';
      return base;
    }

    if (game.stage === 'LIVE') {
      if (selectionId && pokemonId === selectionId) return '4px solid rgba(0,0,0,0.65)';
      return base;
    }

    return base;
  };

  const labelFor = (pokemonId) => {
    if (room.phase === 'REVEAL') {
      const isSolution = solutionId && pokemonId === solutionId;
      const isSelected = selectionId && pokemonId === selectionId;
      if (isSelected && isSolution) return 'RICHTIG';
      if (isSelected && !isSolution) return 'FALSCH';
      if (!isSelected && isSolution) return 'LÖSUNG';
      return '';
    }
    if (game.stage === 'SABOTAGE' && (meIsSaboteur || meIsHost)) {
      if (solutionId && pokemonId === solutionId) return 'LÖSUNG';
    }
    return '';
  };

  const fillFor = (pokemonId) => {
    // In reveal, tint the team's chosen Pokémon green/red, like in other categories.
    if (room.phase === 'REVEAL') {
      const isSolution = solutionId && pokemonId === solutionId;
      const isSelected = selectionId && pokemonId === selectionId;
      if (isSelected && isSolution) return 'var(--correct-bg)';
      if (isSelected && !isSolution) return 'var(--wrong-bg)';
    }
    return '';
  };

  // ---------- Stage Screens ----------
  if (game.stage === 'PICK_SABOTEUR') {
    return (
      <div className="stageCenter" style={{ flex: 1, width: '100%' }}>
        {meIsHost ? (
          <div className="card" style={{ maxWidth: 900, margin: '0 auto' }}>
            <div style={{ fontWeight: 950, fontSize: 18 }}>Saboteur auswählen</div>
            <div className="muted" style={{ marginTop: 6 }}>
              Du wählst den Spieler, der <b>genau 1</b> Sache an den Fakten manipulieren darf.
            </div>
            <div className="hr" />
            <div className="row" style={{ flexWrap: 'wrap', gap: 10 }}>
              {players.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setPicked(p.id)}
                  style={{
                    borderRadius: 999,
                    padding: '10px 12px',
                    border: picked === p.id ? '3px solid rgba(0,0,0,0.65)' : '1px solid rgba(0,0,0,0.15)'
                  }}
                >
                  {p.name}{p.isHost ? ' (Host)' : ''}
                </button>
              ))}
            </div>
            <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
              <button disabled={!picked} onClick={selectSaboteur}>
                Saboteur festlegen
              </button>
            </div>
          </div>
        ) : (
          <div className="card" style={{ maxWidth: 900, margin: '0 auto' }}>
            <div style={{ fontWeight: 950, fontSize: 20 }}>Warte…</div>
            <div className="muted" style={{ marginTop: 6 }}>Der Host wählt gerade den Saboteur aus.</div>
          </div>
        )}
      </div>
    );
  }

  if (game.stage === 'SABOTAGE') {
    // Non saboteur (and not host) waiting screen
    if (!meIsSaboteur && !meIsHost) {
      return (
        <div className="stageCenter" style={{ flex: 1, width: '100%' }}>
          <div className="card" style={{ maxWidth: 900, margin: '0 auto' }}>
            <div style={{ fontWeight: 950, fontSize: 20 }}>Warte…</div>
            <div className="muted" style={{ marginTop: 6 }}>
              Ein Saboteur manipuliert gerade <b>einen</b> Fakt. Gleich geht's los.
            </div>
          </div>
        </div>
      );
    }

    const saboteurName = playersById.get(game.saboteurId)?.name || 'Saboteur';

    return (
      <div className="grid" style={{ gap: 12, height: '100%', gridTemplateColumns: '1.2fr 1fr', minHeight: 0 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0 }}>
          <div className="card" style={{ minHeight: 0 }}>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontWeight: 950, fontSize: 16 }}>Sabotage-Phase</div>
                <div className="muted" style={{ marginTop: 4 }}>
                  {meIsHost ? (
                    <>Saboteur: <b>{saboteurName}</b></>
                  ) : (
                    <>Du bist der <b>Saboteur</b>. Du darfst genau <b>1</b> Sache machen.</>
                  )}
                </div>
              </div>

              {meIsHost ? (
                <button disabled={!game.saboteurReady} onClick={doRelease}>
                  Runde freigeben
                </button>
              ) : null}
            </div>

            {meIsHost ? (
              <div className="muted" style={{ marginTop: 8 }}>
                Status: {game.saboteurReady ? <b>bereit</b> : 'arbeitet…'}
              </div>
            ) : null}
          </div>

          {meIsSaboteur ? (
            <div style={{ border: '1px solid rgba(0,0,0,0.12)', borderRadius: 16, padding: 12, background: '#fff', flex: 1, minHeight: 0, overflow: 'auto' }}>
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontWeight: 950, fontSize: 14 }}>Fakten (Hover markiert passende Pokémon)</div>
                <div className="row" style={{ gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  {!sabotageActionUsed ? (
                    <button onClick={openAdd}>+ Fakt hinzufügen</button>
                  ) : null}
                  {sabotageActionUsed ? <button onClick={doUndo}>Aktion zurücknehmen</button> : null}
                  <button disabled={!sabotageActionUsed || saboteurLocked} onClick={doReady}>
                    Fertig
                  </button>
                </div>
              </div>
              {saboteurLocked ? (
                <div className="muted" style={{ marginTop: 6, textAlign: 'right' }}>
                  Du hast eingelockt.
                </div>
              ) : null}
              <div className="hr" />

              <div className="grid" style={{ gap: 10 }}>
                {(game.facts || []).map((f) => {
                  const canHover = Array.isArray(f.appliesToPokemonIds) && f.appliesToPokemonIds.length > 0;
                  return (
                    <div
                      key={f.id}
                      onMouseEnter={() => setHoverFactId(f.id)}
                      onMouseLeave={() => setHoverFactId(null)}
                      style={{
                        border: '1px solid rgba(0,0,0,0.10)',
                        borderRadius: 14,
                        padding: '10px 12px',
                        background: hoverFactId === f.id ? 'rgba(0,0,0,0.02)' : 'white'
                      }}
                    >
                      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                        <div style={{ fontSize: 16, fontWeight: 900, lineHeight: 1.2, minWidth: 0 }}>
                          {f.text}
                          {!canHover ? (
                            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>(kein Mapping)</div>
                          ) : null}
                        </div>
                        <div className="row" style={{ gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                          {!sabotageActionUsed ? (
                            <>
                              <button onClick={() => openEdit(f.id, f.text)}>Umschreiben</button>
                              <button onClick={() => doDelete(f.id)}>Löschen</button>
                            </>
                          ) : (
                            <span className="badge">1 Aktion genutzt</span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div style={{ border: '1px solid rgba(0,0,0,0.12)', borderRadius: 16, padding: 12, background: '#fff', flex: 1, minHeight: 0, overflow: 'auto' }}>
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontWeight: 950, fontSize: 14 }}>Fakten (Vorschau)</div>
                <span className="badge">nur lesen</span>
              </div>
              <div className="hr" />
              <div className="grid" style={{ gap: 10 }}>
                {(hostFactsSnapshot || []).map((f) => {
                  const canHover = Array.isArray(f.appliesToPokemonIds) && f.appliesToPokemonIds.length > 0;
                  return (
                    <div
                      key={f.id}
                      onMouseEnter={() => setHoverFactId(f.id)}
                      onMouseLeave={() => setHoverFactId(null)}
                      style={{
                        border: '1px solid rgba(0,0,0,0.10)',
                        borderRadius: 14,
                        padding: '10px 12px',
                        background: hoverFactId === f.id ? 'rgba(0,0,0,0.02)' : 'white'
                      }}
                    >
                      <div style={{ fontSize: 16, fontWeight: 900, lineHeight: 1.2 }}>{f.text}</div>
                      {!canHover ? <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>(kein Mapping)</div> : null}
                    </div>
                  );
                })}
                {!hostFactsSnapshot || hostFactsSnapshot.length === 0 ? <div className="muted">(keine Fakten)</div> : null}
              </div>

              {sabotageSummary ? (
                <>
                  <div className="hr" />
                  <div style={{ fontSize: 14, fontWeight: 950, marginBottom: 8 }}>Änderung</div>
                  <div
                    style={{
                      border: '1px solid rgba(0,0,0,0.10)',
                      borderRadius: 14,
                      padding: '10px 12px',
                      background: 'rgba(0,0,0,0.03)',
                      fontSize: 15,
                      fontWeight: 900
                    }}
                  >
                    {sabotageSummary}
                  </div>
                  <div className="row" style={{ justifyContent: 'flex-end', marginTop: 10 }}>
                    <button onClick={doHostUndo}>Aktion rückgängig machen</button>
                  </div>
                </>
              ) : null}
            </div>
          )}
        </div>

        {/* Pokémon */}
        <div style={{ border: '1px solid rgba(0,0,0,0.12)', borderRadius: 16, padding: 12, background: '#fff', minHeight: 0 }}>
          <div style={{ fontWeight: 950, fontSize: 14, marginBottom: 10 }}>Pokémon</div>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(3, minmax(140px, 1fr))', gap: 12 }}>
            {(game.pokemon || []).map((p) => {
              const inHoverSet = hoverFactId ? hoverApplies.has(p.id) : false;
              const dimmed = hoverFactId ? (!inHoverSet && hoverApplies.size > 0) : false;
              return (
                <PokemonCard
                  key={p.id}
                  p={p}
                  border={borderFor(p.id)}
                  fill={fillFor(p.id)}
                  label={labelFor(p.id)}
                  highlighted={inHoverSet}
                  dimmed={dimmed}
                  canClick={false}
                />
              );
            })}
          </div>
        </div>

        {editModal ? (
          <Modal title={editModal.mode === 'add' ? 'Neuen Fakt hinzufügen' : 'Fakt umschreiben'} onClose={() => setEditModal(null)} width={720}>
            <div className="grid" style={{ gap: 10 }}>
              <textarea
                rows={4}
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                placeholder="Fakt..."
              />
              <div className="row" style={{ justifyContent: 'flex-end', gap: 10 }}>
                <button onClick={() => setEditModal(null)}>Abbrechen</button>
                <button onClick={submitEdit} disabled={!editText.trim()}>Bestätigen</button>
              </div>
            </div>
          </Modal>
        ) : null}
      </div>
    );
  }

  // LIVE
  const factsText = Array.isArray(game.factsText) ? game.factsText : [];
  const factsKey = game.factsRevision || 'facts';

  return (
    <div className="grid" style={{ gap: 12, height: '100%', gridTemplateColumns: '1fr 1fr', minHeight: 0 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0 }}>
        {game.prompt ? (
          <div className="card">
            <div style={{ fontWeight: 950, fontSize: 18 }}>{game.prompt}</div>
            <div className="muted" style={{ marginTop: 6 }}>Hinweis: Es wurde sabotiert.</div>
          </div>
        ) : (
          <div className="card">
            <div style={{ fontWeight: 950, fontSize: 18 }}>Hinweis: Es wurde sabotiert.</div>
          </div>
        )}

        <div key={factsKey} style={{ flex: 1, minHeight: 0 }}>
          <FactsList factsText={factsText} canInteract={canInteract} />
        </div>
      </div>

      <div style={{ border: '1px solid rgba(0,0,0,0.12)', borderRadius: 16, padding: 12, background: '#fff', minHeight: 0 }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontWeight: 950, fontSize: 14 }}>Auswahl</div>
          {room.phase === 'REVEAL' ? <span className="badge">Reveal</span> : null}
        </div>
        <div className="hr" />
        <div className="grid" style={{ gridTemplateColumns: 'repeat(2, minmax(220px, 1fr))', gap: 14 }}>
          {(game.pokemon || []).map((p) => (
            <PokemonCard
              key={p.id}
              p={p}
              border={borderFor(p.id)}
              fill={fillFor(p.id)}
              label={labelFor(p.id)}
              highlighted={false}
              dimmed={false}
              width={220}
              height={220}
              canClick={canInteract && room.phase === 'IN_ROUND'}
              onClick={() => doPick(p.id)}
            />
          ))}
        </div>
        {!meIsHost ? (
          <div className="muted" style={{ marginTop: 10 }}>
            Klickt ein Pokémon an, um es auszuwählen (erneut klicken = abwählen). Der Host kann locken.
          </div>
        ) : null}
      </div>
    </div>
  );
}
