import React, { useEffect, useMemo, useState } from 'react';
import PlayerList from './PlayerList.jsx';
import HostPanel from './HostPanel.jsx';
import GameRenderer from './GameRenderer.jsx';

export default function RoomView({ socket, me, room }) {
  const meIsHost = room && room.hostId === me.playerId;
  const [streamMode, setStreamMode] = useState(() => {
    try {
      return localStorage.getItem('streamMode') === '1';
    } catch {
      return false;
    }
  });
  // Activity list is provided by the server in the room state.
  const [cat, setCat] = useState('aufzaehlen');
  const roundsForCat = (room?.rounds?.[cat] || []);
  const [roundId, setRoundId] = useState('');

  useEffect(() => {
    if (!roundsForCat.length) {
      setRoundId('');
    } else if (!roundId || !roundsForCat.some((r) => r.id === roundId)) {
      setRoundId(roundsForCat[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cat, room?.rounds]);

  const phaseLabel = useMemo(() => {
    if (!room) return '';
    if (room.phase === 'HUB') return 'Warte auf nächste Runde / Spielstart';
    if (room.phase === 'IN_ROUND') return 'Runde läuft';
    if (room.phase === 'REVEAL') return 'Lösung / Auswertung';
    return room.phase;
  }, [room]);

  useEffect(() => {
    try {
      localStorage.setItem('streamMode', streamMode ? '1' : '0');
    } catch {
      // ignore
    }
  }, [streamMode]);

  // Stream mode is for players only. Host needs the controls to switch rounds.
  useEffect(() => {
    if (meIsHost && streamMode) setStreamMode(false);
  }, [meIsHost, streamMode]);
  if (!room) return <div className="card">Verbinde...</div>;

  return (
    <div className="grid" style={{ gridTemplateColumns: (!meIsHost && streamMode) ? '1fr' : '330px 1fr', gap: 14 }}>
      {(!meIsHost && streamMode) ? (
        <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={() => setStreamMode(false)} style={{ padding: '8px 10px', borderRadius: 10 }}>
            Stream-Modus aus
          </button>
        </div>
      ) : null}

      {(!meIsHost && streamMode) ? null : (
      <div className="grid" style={{ gap: 12 }}>
        <div className="card">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: 16 }}>Hub</div>
              <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>{phaseLabel}</div>
            </div>
            <div className="row" style={{ gap: 8 }}>
              {!meIsHost ? (
                <button
                  onClick={() => setStreamMode(true)}
                  title="Zeigt nur die 16:9 Bühne größer (ohne Sidebar)"
                  style={{ padding: '8px 10px', borderRadius: 10 }}
                >
                  Streamer-Modus
                </button>
              ) : null}
              {room.locked ? <span className="badge">LOCK</span> : <span className="badge">frei</span>}
            </div>
          </div>
          <div className="hr" />
          <PlayerList players={room.players} />
        </div>

        {meIsHost ? (
          <HostPanel
            socket={socket}
            me={me}
            room={room}
            category={cat}
            setCategory={setCat}
            roundId={roundId}
            setRoundId={setRoundId}
          />
        ) : (
          <div className="card">
            <div style={{ fontWeight: 800 }}>Warte...</div>
            <p className="muted" style={{ marginBottom: 0 }}>
              Du bleibst automatisch im Room. Der Host startet die nächste Runde.
            </p>
          </div>
        )}
      </div>
      )}

      <div className="stageWrap">
        <div className="stageFrame">
          <GameRenderer socket={socket} me={me} room={room} />
        </div>
      </div>
    </div>
  );
}
