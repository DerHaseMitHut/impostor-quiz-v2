let activeRoomChannel = null;
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from './supabaseClient';
import { getSocket } from './socket';
import RoomView from './components/RoomView.jsx';

function ensureCodeUpper(code) {
  return String(code || '').trim().toUpperCase();
}

function sanitizeName(name) {
  const s = String(name || '').trim();
  if (!s) return 'Spieler';
  return s.slice(0, 24);
}

function randPlayerId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return `p_${crypto.randomUUID()}`;
  return `p_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

function makeRoomCode() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 5; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function deepClone(x) {
  return JSON.parse(JSON.stringify(x ?? null));
}

function normalizePlayers(players, hostId) {
  // Accept legacy format {playerId,name,role} and normalize to {id,name,connected,joinedAt,isHost}
  const list = Array.isArray(players) ? players : [];
  const out = [];
  for (const p of list) {
    const id = String(p?.id || p?.playerId || '').trim();
    if (!id) continue;
    out.push({
      id,
      name: sanitizeName(p?.name),
      connected: p?.connected !== false, // default true
      joinedAt: typeof p?.joinedAt === 'number' ? p.joinedAt : Date.now(),
      isHost: id === hostId
    });
  }
  // de-dupe by id (keep last)
  const map = new Map();
  for (const p of out) map.set(p.id, p);
  return [...map.values()];
}

function ensureHost(state) {
  const players = Array.isArray(state.players) ? state.players : [];
  const hostId = String(state.hostId || state.hostPlayerId || '');
  const host = players.find((p) => p.id === hostId);
  if (host && host.connected) {
    state.hostId = hostId;
    state.hostPlayerId = hostId;
    return;
  }
  const connected = players.filter((p) => p.connected);
  connected.sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0));
  const newHost = connected[0]?.id || hostId || (players[0]?.id ?? '');
  state.hostId = newHost;
  state.hostPlayerId = newHost;
}

async function fetchRoomState(code) {
  const { data, error } = await supabase
    .from('room_state')
    .select('state, updated_at')
    .eq('code', code)
    .single();
  if (error) return { ok: false, error };
  return { ok: true, state: data?.state || null, updated_at: data?.updated_at || null };
}

async function writeRoomStateCAS(code, prevUpdatedAt, nextState) {
  const { data, error } = await supabase
    .from('room_state')
    .update({ state: nextState, updated_at: new Date().toISOString() })
    .eq('code', code)
    .eq('updated_at', prevUpdatedAt)
    .select('updated_at')
    .single();
  if (error) return { ok: false, error };
  return { ok: true, updated_at: data?.updated_at || null };
}

async function updateRoomState(code, mutator, tries = 6) {
  let lastErr = null;
  for (let i = 0; i < tries; i++) {
    const fr = await fetchRoomState(code);
    if (!fr.ok) return fr;
    const st = deepClone(fr.state || {});
    const prev = fr.updated_at;
    const changed = await mutator(st);
    if (changed === false) return { ok: true, skipped: true, state: st };
    const wr = await writeRoomStateCAS(code, prev, st);
   if (wr.ok) {
  if (activeRoomChannel) {
    await activeRoomChannel.send({
      type: "broadcast",
      event: "state_updated",
      payload: { code }
    });
  }
  return { ok: true, state: st, updated_at: wr.updated_at };
}


    lastErr = wr.error;
  }
  return { ok: false, error: lastErr || new Error('conflict') };
}

function JoinCard({ defaultName, status, onCreate, onJoin }) {
  const [name, setName] = useState(defaultName || '');
  const [code, setCode] = useState('');

  return (
    <div className="card" style={{ maxWidth: 520, margin: '0 auto' }}>
      <div style={{ fontWeight: 900, fontSize: 18, marginBottom: 10 }}>Room beitreten</div>

      <div className="grid" style={{ gap: 10 }}>
        <label className="row" style={{ gap: 10 }}>
          <div style={{ width: 90 }} className="muted">Name</div>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Dein Name" />
        </label>

        <label className="row" style={{ gap: 10 }}>
          <div style={{ width: 90 }} className="muted">Room</div>
          <input
            value={code}
            onChange={(e) => setCode(ensureCodeUpper(e.target.value))}
            placeholder="ABCDE"
            style={{ textTransform: 'uppercase', letterSpacing: 2 }}
          />
        </label>

        {status ? <div className="muted" style={{ marginTop: 4 }}>{status}</div> : null}

        <div className="row" style={{ justifyContent: 'space-between', gap: 10, marginTop: 8 }}>
          <button onClick={() => onCreate(name)} style={{ flex: 1 }}>
            Neuen Room erstellen
          </button>
          <button onClick={() => onJoin(code, name)} style={{ flex: 1 }}>
            Beitreten
          </button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const socket = useMemo(() => getSocket(), []);
  const [conn, setConn] = useState(true);

  const [status, setStatus] = useState('');
  const [roomState, setRoomState] = useState(null);
  const roomStateRef = useRef(null);

  const [me, setMe] = useState(() => ({
    playerId: localStorage.getItem('ptq_playerId') || randPlayerId(),
    name: localStorage.getItem('ptq_name') || '',
    code: localStorage.getItem('ptq_code') || '',
  }));

  const [roundsIndex, setRoundsIndex] = useState({});

  useEffect(() => {
    roomStateRef.current = roomState;
  }, [roomState]);

  // ---------- Load rounds index ----------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('rounds')
        .select('id,category,name')
        .order('category', { ascending: true })
        .order('name', { ascending: true });
      if (cancelled) return;
      if (error) {
        console.error(error);
        return;
      }
      const idx = {};
      for (const row of (data || [])) {
        if (!idx[row.category]) idx[row.category] = [];
        idx[row.category].push({ id: row.id, name: row.name || row.id });
      }
      setRoundsIndex(idx);
      setRoomState((prev) => prev ? { ...prev, rounds: idx } : prev);
    })();
    return () => { cancelled = true; };
  }, []);

  // ---------- Subscribe to room state ----------
  useEffect(() => {
    const code = ensureCodeUpper(me.code);
    if (!code) return;

    let channel = null;
    let cancelled = false;

    (async () => {
      const fr = await fetchRoomState(code);
      if (cancelled) return;
      if (fr.ok && fr.state) {
        const st = deepClone(fr.state);
        st.code = code;
        const hostId = String(st.hostId || st.hostPlayerId || '');
        st.hostId = hostId;
        st.hostPlayerId = hostId;
        st.players = normalizePlayers(st.players, hostId);
        ensureHost(st);
        // decorate host flags
        st.players = st.players.map((p) => ({ ...p, isHost: p.id === st.hostId }));
        st.rounds = roundsIndex;
        setRoomState(st);
        setStatus('');
      } else {
        setStatus('Raum nicht gefunden.');
        setRoomState(null);
      }

      console.log("SUBSCRIBE room_state code =", code);

     channel = supabase
  .channel(`room:${code}`, { config: { broadcast: { self: true } } })
  .on("broadcast", { event: "state_updated" }, async (msg) => {
  console.log("GOT state_updated", msg);
  const fr2 = await fetchRoomState(code);
  if (!fr2.ok || !fr2.state) return;

  const st = deepClone(fr2.state);
  st.code = code;
  const hostId2 = String(st.hostId || st.hostPlayerId || '');
  st.hostId = hostId2;
  st.hostPlayerId = hostId2;
  st.players = normalizePlayers(st.players, hostId2);
  ensureHost(st);
  st.players = st.players.map((p) => ({ ...p, isHost: p.id === st.hostId }));
  st.rounds = roundsIndex;
  setRoomState(st);
})

  .subscribe((s) => setConn(s === "SUBSCRIBED"));


activeRoomChannel = channel; // <— DAS ist der wichtige Teil

    })();

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
      if (activeRoomChannel === channel) activeRoomChannel = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me.code]);

  // ---------- Create ----------
  const doCreate = async (rawName) => {
    try {
      const name = sanitizeName(rawName);
      const playerId = me.playerId || randPlayerId();
      let code = makeRoomCode();

      setStatus('Erstelle Room…');

      // retry room code if collision
      for (let i = 0; i < 5; i++) {
        const { error } = await supabase.from('rooms').insert({ code, host_player_id: playerId });
        if (!error) break;
        code = makeRoomCode();
        if (i === 4) throw error;
      }

      const initialState = {
        code,
        hostId: playerId,
        hostPlayerId: playerId,
        phase: 'HUB',
        locked: false,
        activeRound: null,
        game: null,
        activity: [],
        players: [{ id: playerId, name, connected: true, joinedAt: Date.now() }]
      };

      const { error: e2 } = await supabase.from('room_state').insert({ code, state: initialState });
      if (e2) throw e2;

      localStorage.setItem('ptq_playerId', playerId);
      localStorage.setItem('ptq_name', name);
      localStorage.setItem('ptq_code', code);

      setMe({ playerId, name, code });
      setStatus('');
    } catch (e) {
      console.error(e);
      setStatus('Create fehlgeschlagen (RLS/Env?).');
    }
  };

  // ---------- Join ----------
  const doJoin = async (rawCode, rawName) => {
    const code = ensureCodeUpper(rawCode);
    const name = sanitizeName(rawName);
    if (!code) return setStatus('Bitte Room-Code eingeben.');
    if (!name) return setStatus('Bitte Name eingeben.');

    const playerId = me.playerId || randPlayerId();

    setStatus('Trete Room bei…');

    try {
      const r = await updateRoomState(code, (st) => {
        const hostId = String(st.hostId || st.hostPlayerId || '');
        st.hostId = hostId;
        st.hostPlayerId = hostId;
        st.players = normalizePlayers(st.players, hostId);

        const existing = st.players.find((p) => p.id === playerId);
        if (existing) {
          existing.name = name;
          existing.connected = true;
        } else {
          st.players.push({ id: playerId, name, connected: true, joinedAt: Date.now() });
        }
        ensureHost(st);
        st.players = st.players.map((p) => ({ ...p, isHost: p.id === st.hostId }));
        return true;
      });

      if (!r.ok) {
        console.error(r.error);
        setStatus('Raum nicht gefunden oder Join fehlgeschlagen.');
        return;
      }

      localStorage.setItem('ptq_playerId', playerId);
      localStorage.setItem('ptq_name', name);
      localStorage.setItem('ptq_code', code);

      setMe({ playerId, name, code });
      setStatus('');
    } catch (e) {
      console.error(e);
      setStatus('Join fehlgeschlagen.');
    }
  };

  // ---------- Leave ----------
  const doLeave = async () => {
    const code = ensureCodeUpper(me.code);
    const playerId = me.playerId;
    try {
      if (code && playerId) {
        await updateRoomState(code, (st) => {
          const hostId = String(st.hostId || st.hostPlayerId || '');
          st.hostId = hostId;
          st.hostPlayerId = hostId;
          st.players = normalizePlayers(st.players, hostId);

          const p = st.players.find((x) => x.id === playerId);
          if (p) p.connected = false;
          ensureHost(st);
          st.players = st.players.map((pp) => ({ ...pp, isHost: pp.id === st.hostId }));
          return true;
        });
      }
    } catch (e) {
      console.warn('leave update failed', e);
    }

    localStorage.removeItem('ptq_code');
    setMe((m) => ({ ...m, code: '' }));
    setRoomState(null);
    setStatus('');
  };

  // ---------- Auto-rejoin ----------
  const rejoinOnceRef = useRef(false);
  useEffect(() => {
    if (rejoinOnceRef.current) return;

    const code = ensureCodeUpper(me.code);
    const name = (me.name || '').trim();
    if (!code || !name) return;

    rejoinOnceRef.current = true;
    doJoin(code, name);

    const t = setTimeout(() => {
      if (!roomStateRef.current) {
        localStorage.removeItem('ptq_code');
        setMe((m) => ({ ...m, code: '' }));
        setRoomState(null);
        setStatus('');
      }
    }, 2500);

    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const inRoom = Boolean(ensureCodeUpper(me.code));

  return (
    <div className="container">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
        <div className="row" style={{ gap: 10 }}>
          <div style={{ fontWeight: 800, fontSize: 18 }}>Pokémon Team Quiz</div>
          <span className="badge">{conn ? 'online' : 'offline'}</span>
          {inRoom && roomState?.code ? <span className="badge">Room: {roomState.code}</span> : null}
        </div>
        {inRoom ? <button onClick={doLeave}>Verlassen</button> : null}
      </div>

      {!inRoom ? (
        <JoinCard defaultName={me.name} status={status} onCreate={doCreate} onJoin={doJoin} />
      ) : roomState ? (
        <RoomView socket={socket} me={{ playerId: me.playerId, name: me.name }} room={roomState} />
      ) : (
        <div className="card">
          <div style={{ fontWeight: 900, marginBottom: 6 }}>Verbinde…</div>
          <div className="muted" style={{ marginBottom: 10 }}>
            Room-Code: <b>{ensureCodeUpper(me.code)}</b>
          </div>
          <div className="muted">{status || 'Hole Raumstatus…'}</div>
          <div className="row" style={{ gap: 10, marginTop: 12 }}>
            <button onClick={doLeave}>Zurück</button>
          </div>
        </div>
      )}
    </div>
  );
}
