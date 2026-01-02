import React, { useEffect, useMemo, useState } from 'react';
import Modal from './Modal.jsx';
import RoundsManager from './RoundsManager.jsx';
import { supabase } from '../supabaseClient';


const CAT_LABEL = {
  aufzaehlen: 'Aufzählen',
  trifft: 'Trifft zu / Trifft nicht zu',
  sortieren: 'Sortieren',
  fakten: 'Sabotierte Fakten'
};

export default function HostPanel({ socket, me, room, category, setCategory, roundId, setRoundId }) {
  const [showRounds, setShowRounds] = useState(false);
  const [roundsMeta, setRoundsMeta] = useState(null);

  // Rundenliste direkt aus Supabase laden (damit Host-Panel unabhängig vom room_state.rounds funktioniert)
  useEffect(() => {
    let alive = true;
    (async () => {
      const { data, error } = await supabase.from('rounds').select('id,category,name');
      if (!alive) return;
      if (error) {
        console.error('[supabase] rounds fetch failed', error);
        setRoundsMeta({});
        return;
      }
      const grouped = { aufzaehlen: [], trifft: [], sortieren: [], fakten: [] };
      for (const r of data || []) {
        if (!grouped[r.category]) grouped[r.category] = [];
        grouped[r.category].push({ id: r.id, name: r.name });
      }
      for (const k of Object.keys(grouped)) {
        grouped[k].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'de'));
      }
      setRoundsMeta(grouped);
    })();
    return () => { alive = false; };
  }, [showRounds]);

  const catOptions = useMemo(() => Object.keys(CAT_LABEL), []);
  const roundsForCat = (roundsMeta?.[category] || room?.rounds?.[category] || []);

  // Wenn noch keine Runde ausgewählt ist, automatisch die erste (damit Start nicht ausgegraut bleibt)
  useEffect(() => {
    const firstId = roundsForCat[0]?.id || '';
    if (!roundId && firstId) setRoundId(firstId);
  }, [category, roundsForCat.length, roundId]);

  // Allow starting a new round directly after REVEAL (without going back to the HUB screen).
  const canStart = (room.phase === 'HUB' || room.phase === 'REVEAL') && Boolean(roundId);
  const faktenNeedsLive = room.game?.category === 'fakten' && room.game?.stage !== 'LIVE';

  const canLock = room.phase === 'IN_ROUND' && !room.locked && !faktenNeedsLive;
  const canUnlock = room.phase === 'IN_ROUND' && room.locked && !faktenNeedsLive;
  const canReveal = room.phase === 'IN_ROUND' && !faktenNeedsLive;
  const canHub = room.phase !== 'HUB';

  const canRestart = Boolean(room.activeRound) && (room.phase === 'IN_ROUND' || room.phase === 'REVEAL');

  const start = () => {
    socket.emit('host:startRound', { code: room.code, playerId: me.playerId, category, roundId }, () => {});
  };
  const lock = () => socket.emit('host:lock', { code: room.code, playerId: me.playerId }, () => {});
  const unlock = () => socket.emit('host:unlock', { code: room.code, playerId: me.playerId }, () => {});
  const reveal = () => socket.emit('host:reveal', { code: room.code, playerId: me.playerId }, () => {});
  const hub = () => socket.emit('host:hub', { code: room.code, playerId: me.playerId }, () => {});

  const restart = () => {
    if (!room.activeRound) return;
    socket.emit(
      'host:startRound',
      { code: room.code, playerId: me.playerId, category: room.activeRound.category, roundId: room.activeRound.roundId },
      () => {}
    );
  };

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontWeight: 900 }}>Host Panel</div>
          <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
            Kategorie wählen, Runde starten, locken und auswerten.
          </div>
        </div>
        <button onClick={() => setShowRounds(true)}>Runden verwalten</button>
      </div>

      <div className="hr" />

      <div className="grid" style={{ gap: 10 }}>
        <label>
          <div className="pill" style={{ marginBottom: 6 }}>Kategorie</div>
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            {catOptions.map((c) => (
              <option key={c} value={c}>{CAT_LABEL[c]}</option>
            ))}
          </select>
        </label>

        <label>
          <div className="pill" style={{ marginBottom: 6 }}>Gespeicherte Runde</div>
          <select value={roundId} onChange={(e) => setRoundId(e.target.value)}>
            {roundsForCat.length ? (
              roundsForCat.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)
            ) : (
              <option value="">(keine Runden gespeichert)</option>
            )}
          </select>
        </label>

        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          <button disabled={!canStart} onClick={start}>Start</button>
          <button disabled={!canRestart} onClick={restart} title="Startet die aktuell aktive Runde nochmal von vorne">
            Runde neu starten
          </button>
          <button disabled={!canLock} onClick={lock}>Lock</button>
          <button disabled={!canUnlock} onClick={unlock}>Unlock</button>
          <button disabled={!canReveal} onClick={reveal}>Lösung zeigen</button>
          <button disabled={!canHub} onClick={hub}>Zurück zum Hub</button>
        </div>

        {room.activeRound ? (
          <div className="muted" style={{ fontSize: 13 }}>
            Aktiv: <b>{CAT_LABEL[room.activeRound.category]}</b> — {room.activeRound.roundName}
          </div>
        ) : (
          <div className="muted" style={{ fontSize: 13 }}>Aktiv: (keine Runde)</div>
        )}
      </div>

      {showRounds ? (
        <Modal title="Runden verwalten" onClose={() => setShowRounds(false)}>
          <RoundsManager socket={socket} me={me} room={room} />
        </Modal>
      ) : null}
    </div>
  );
}