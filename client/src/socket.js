import { supabase } from './supabaseClient';

/**
 * Supabase-only "socket" adapter.
 * The UI still calls `socket.emit(event, payload, cb)` and listens with `socket.on(...)`.
 * We implement those events by writing to `room_state.state` and rely on Supabase Realtime
 * subscriptions in App.jsx to update all clients.
 */

const LOCK_TTL_MS = 15000;
const ACTIVITY_TTL_MS = 5000;
const MAX_ACTIVITY = 4;

const listeners = new Map(); // event -> Set<fn>
function emitLocal(event, payload) {
  const set = listeners.get(event);
  if (!set) return;
  for (const fn of [...set]) {
    try { fn(payload); } catch (e) { console.error(e); }
  }
}

export function resolveAsset(url) {
  if (!url) return '';
  // Old server assets were referenced as /public/xyz.png
  if (url.startsWith('/public/')) return '/' + url.slice('/public/'.length);
  return url;
}

function randId(prefix = 'id') {
  const c = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  return `${prefix}_${c}`;
}

function deepClone(x) {
  return JSON.parse(JSON.stringify(x ?? null));
}

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = arr[i];
    arr[i] = arr[j];
    arr[j] = t;
  }
  return arr;
}

function sanitizeName(name) {
  const s = String(name ?? '').trim();
  if (!s) return 'Spieler';
  return s.slice(0, 24);
}

function playerDisplayName(state, playerId) {
  const p = (state.players || []).find((x) => x.id === playerId);
  return p?.name || 'Spieler';
}

function ensureHost(state) {
  const host = (state.players || []).find((p) => p.id === state.hostId);
  if (host && host.connected) return;
  const connected = (state.players || []).filter((p) => p.connected);
  connected.sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0));
  if (connected.length) state.hostId = connected[0].id;
}

function isHost(state, playerId) {
  return state.hostId === playerId;
}

function clearExpiredLocks(state) {
  if (!state.game) return;
  const cat = state.game.category;
  if (cat !== 'trifft' && cat !== 'sortieren') return;
  const locks = state.game.locks || {};
  const t = Date.now();
  let changed = false;
  for (const [itemId, lock] of Object.entries(locks)) {
    if (lock && Number(lock.expiresAt || 0) <= t) {
      locks[itemId] = null;
      changed = true;
    }
  }
  if (changed) state.game.locks = locks;
}

function addActivity(state, text) {
  const e = { id: randId('a'), ts: Date.now(), ttlMs: ACTIVITY_TTL_MS, text: String(text || '').slice(0, 140) };
  const list = Array.isArray(state.activity) ? [...state.activity] : [];
  list.unshift(e);
  while (list.length > MAX_ACTIVITY) list.pop();
  state.activity = list;
}

async function fetchRoomRow(code) {
  const { data, error } = await supabase
    .from('room_state')
    .select('state, updated_at')
    .eq('code', code)
    .single();
  if (error) return { ok: false, error };
  return { ok: true, state: data?.state || null, updated_at: data?.updated_at || null };
}

async function writeRoomRowCAS(code, prevUpdatedAt, nextState) {
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

async function updateRoomState(code, mutator, { tries = 6 } = {}) {
  let lastErr = null;
  for (let i = 0; i < tries; i++) {
    const fr = await fetchRoomRow(code);
    if (!fr.ok) return fr;
    const st = deepClone(fr.state || {});
    const prev = fr.updated_at;
    try {
      const changed = await mutator(st);
      if (changed === false) return { ok: true, skipped: true };
    } catch (e) {
      return { ok: false, error: e };
    }
    const wr = await writeRoomRowCAS(code, prev, st);
    if (wr.ok) return { ok: true, state: st, updated_at: wr.updated_at };
    lastErr = wr.error;
    // retry on conflict
  }
  return { ok: false, error: lastErr || new Error('conflict') };
}

// ---------------- Round loading ----------------

function normalizeRoundRow(row) {
  if (!row) return null;
  return { id: row.id, name: row.name || '', category: row.category, data: row.data || {} };
}

async function fetchRoundById(roundId) {
  const { data, error } = await supabase.from('rounds').select('id,category,name,data').eq('id', roundId).single();
  if (error) return { ok: false, error };
  return { ok: true, round: normalizeRoundRow(data) };
}

function makeEmptyEnumerateGrid(rows, cols) {
  const out = [];
  const n = Math.max(1, Number(rows || 1)) * Math.max(1, Number(cols || 1));
  for (let i = 0; i < n; i++) out.push({ text: '', ownerId: null, status: 'neutral' });
  return out;
}

function initGameState(category, round) {
  const data = round?.data || {};
  if (category === 'aufzaehlen') {
    const rows = Number(data.rows || 4);
    const cols = Number(data.cols || 10);
    return {
      category,
      question: String(data.question || ''),
      rows,
      cols,
      cells: makeEmptyEnumerateGrid(rows, cols),
    };
  }

  if (category === 'trifft') {
    const items = Array.isArray(data.items) ? data.items.map((it, idx) => ({
      id: String(it.id || `it_${idx}`),
      name: String(it.name || ''),
      imgUrl: resolveAsset(String(it.imgUrl || '')),
    })) : [];

    const placements = {};
    const statuses = {};
    const locks = {};
    for (const it of items) {
      placements[it.id] = 'pool';
      statuses[it.id] = 'neutral';
      locks[it.id] = null;
    }
    return {
      category,
      thesis: String(data.thesis || ''),
      items,
      placements,
      statuses,
      locks,
    };
  }

  if (category === 'sortieren') {
    const items = Array.isArray(data.items) ? data.items.map((it, idx) => ({
      id: String(it.id || `it_${idx}`),
      name: String(it.name || ''),
      imgUrl: resolveAsset(String(it.imgUrl || '')),
    })) : [];

    const locks = {};
    for (const it of items) locks[it.id] = null;

    const poolOrder = items.map((it) => it.id);
    shuffleInPlace(poolOrder);

    const solutionOrder = Array.isArray(data.solutionOrder) ? data.solutionOrder.map(String) : items.map((it) => it.id);

    return {
      category,
      axisLeftLabel: String(data.axisLeftLabel || ''),
      axisRightLabel: String(data.axisRightLabel || ''),
      items,
      locks,
      slots: new Array(items.length).fill(null),
      poolOrder,
      solutionOrder,
      reveal: null,
    };
  }

  if (category === 'fakten') {
    const pokemon = Array.isArray(data.pokemon) ? data.pokemon.map((p, idx) => ({
      id: String(p.id || `p_${idx}`),
      name: String(p.name || ''),
      imgUrl: resolveAsset(String(p.imgUrl || '')),
    })) : [];

    const facts = Array.isArray(data.facts) ? data.facts.map((f, idx) => ({
      id: String(f.id || `f_${idx}`),
      text: String(f.text || ''),
      appliesToPokemonIds: Array.isArray(f.appliesToPokemonIds) ? f.appliesToPokemonIds.map(String) : null,
    })) : [];

    shuffleInPlace(facts);

    return {
      category,
      stage: 'PICK_SABOTEUR', // PICK_SABOTEUR | SABOTAGE | LIVE
      prompt: String(data.prompt || ''),
      pokemon,
      facts,
      solutionPokemonId: data.solutionPokemonId ? String(data.solutionPokemonId) : null,
      saboteurId: null,
      saboteurReady: false,
      sabotage: { actionUsed: false, actionType: null, detail: null, snapshotFacts: null },
      factsText: null,
      factsRevision: null,
      teamPickPokemonId: null,
    };
  }

  if (category === 'fehler') {
    return {
      category,
      errorImageUrl: resolveAsset(String(data.errorImageUrl || '')),
      correctImageUrl: resolveAsset(String(data.correctImageUrl || '')),
      imageWidth: Number(data.imageWidth || 0),
      imageHeight: Number(data.imageHeight || 0),
      solution: data.solution || null,
      marker: null,
    };
  }

  return { category, data };
}

function computeSortReveal(game) {
  const correctness = (game.slots || []).map((itId, idx) => itId != null && itId === (game.solutionOrder || [])[idx]);
  return { correctness };
}

// ---------------- "Socket" adapter ----------------

export function getSocket() {
  return socket;
}

export const socket = {
  on(event, fn) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(fn);
  },
  off(event, fn) {
    const set = listeners.get(event);
    if (!set) return;
    set.delete(fn);
  },
  emit(event, payload, cb) {
    const safeCb = (res) => { try { cb?.(res); } catch {} };
    const code = String(payload?.code || '').trim().toUpperCase();

    // room:create and room:join are handled in App.jsx (direct writes), but we
    // keep these for compatibility if older code calls them.
    if (event === 'room:create' || event === 'room:join') {
      safeCb({ ok: false, error: 'handled_in_app' });
      return;
    }

    if (!code) {
      safeCb({ ok: false, error: 'no_code' });
      return;
    }

    // Host: start round
    if (event === 'host:startRound') {
      const playerId = String(payload?.playerId || '');
      const category = String(payload?.category || '');
      const roundId = String(payload?.roundId || '');
      (async () => {
        const rr = await fetchRoundById(roundId);
        if (!rr.ok) return safeCb({ ok: false, error: 'round_not_found' });

        await updateRoomState(code, (st) => {
          ensureHost(st);
          if (!isHost(st, playerId)) throw new Error('not_host');
          st.phase = 'IN_ROUND';
          st.locked = false;
          st.activity = [];
          st.activeRound = { category, roundId, roundName: rr.round?.name || '' };
          st.game = initGameState(category, rr.round);
          // Some UI expects hub rounds to be available; keep st.rounds as-is.
          return true;
        });
        safeCb({ ok: true });
      })();
      return;
    }

    if (event === 'host:lock') {
      const playerId = String(payload?.playerId || '');
      (async () => {
        const r = await updateRoomState(code, (st) => {
          ensureHost(st);
          if (!isHost(st, playerId)) throw new Error('not_host');
          if (st.phase !== 'IN_ROUND') return false;
          // Fakten: host can only lock once stage is LIVE
          if (st.game?.category === 'fakten' && st.game?.stage !== 'LIVE') return false;
          st.locked = true;
          return true;
        });
        safeCb({ ok: Boolean(r.ok) });
      })();
      return;
    }

    if (event === 'host:unlock') {
      const playerId = String(payload?.playerId || '');
      (async () => {
        const r = await updateRoomState(code, (st) => {
          ensureHost(st);
          if (!isHost(st, playerId)) throw new Error('not_host');
          if (st.phase !== 'IN_ROUND') return false;
          if (st.game?.category === 'fakten' && st.game?.stage !== 'LIVE') return false;
          st.locked = false;
          return true;
        });
        safeCb({ ok: Boolean(r.ok) });
      })();
      return;
    }

    if (event === 'host:reveal') {
      const playerId = String(payload?.playerId || '');
      (async () => {
        await updateRoomState(code, (st) => {
          ensureHost(st);
          if (!isHost(st, playerId)) throw new Error('not_host');
          if (st.phase !== 'IN_ROUND') return false;
          // Fakten: reveal only once LIVE
          if (st.game?.category === 'fakten' && st.game?.stage !== 'LIVE') return false;
          st.phase = 'REVEAL';
          if (st.game?.category === 'sortieren') {
            st.game.reveal = computeSortReveal(st.game);
          }
          return true;
        });
        safeCb({ ok: true });
      })();
      return;
    }

    if (event === 'host:hub') {
      const playerId = String(payload?.playerId || '');
      (async () => {
        await updateRoomState(code, (st) => {
          ensureHost(st);
          if (!isHost(st, playerId)) throw new Error('not_host');
          st.phase = 'HUB';
          st.locked = false;
          st.activeRound = null;
          st.game = null;
          st.activity = [];
          return true;
        });
        safeCb({ ok: true });
      })();
      return;
    }

    // ---------------- Game events ----------------

    if (event === 'aufzaehlen:add') {
      const playerId = String(payload?.playerId || '');
      const text = String(payload?.text || '').trim();
      (async () => {
        await updateRoomState(code, (st) => {
          clearExpiredLocks(st);
          if (st.phase !== 'IN_ROUND' || st.locked) throw new Error('locked');
          if (st.game?.category !== 'aufzaehlen') throw new Error('bad_game');
          if (!text) throw new Error('empty');
          const idx = (st.game.cells || []).findIndex((c) => !c.text);
          if (idx === -1) throw new Error('full');
          st.game.cells[idx] = { text: text.slice(0, 60), ownerId: playerId, status: 'neutral' };
          addActivity(st, `${playerDisplayName(st, playerId)} gibt „${text.slice(0, 60)}“ ein`);
          return true;
        });
        safeCb({ ok: true });
      })();
      return;
    }

    if (event === 'aufzaehlen:delete') {
      const playerId = String(payload?.playerId || '');
      const index = Number(payload?.index ?? -1);
      (async () => {
        await updateRoomState(code, (st) => {
          if (st.phase !== 'IN_ROUND' || st.locked) throw new Error('locked');
          if (st.game?.category !== 'aufzaehlen') throw new Error('bad_game');
          const cells = st.game.cells || [];
          if (index < 0 || index >= cells.length) throw new Error('bad_index');
          const cell = cells[index];
          const canDelete = isHost(st, playerId) || cell.ownerId === playerId;
          if (!canDelete) throw new Error('forbidden');
          cells[index] = { text: '', ownerId: null, status: 'neutral' };
          st.game.cells = cells;
          return true;
        });
        safeCb({ ok: true });
      })();
      return;
    }

    if (event === 'aufzaehlen:clearAll') {
      const playerId = String(payload?.playerId || '');
      (async () => {
        await updateRoomState(code, (st) => {
          if (st.phase !== 'IN_ROUND') throw new Error('bad_state');
          if (!isHost(st, playerId)) throw new Error('not_host');
          if (st.game?.category !== 'aufzaehlen') throw new Error('bad_game');
          st.game.cells = makeEmptyEnumerateGrid(st.game.rows, st.game.cols);
          return true;
        });
        safeCb({ ok: true });
      })();
      return;
    }

    if (event === 'aufzaehlen:mark') {
      const playerId = String(payload?.playerId || '');
      const index = Number(payload?.index ?? -1);
      const status = String(payload?.status || 'neutral');
      (async () => {
        await updateRoomState(code, (st) => {
          if (!isHost(st, playerId)) throw new Error('not_host');
          if (st.phase !== 'IN_ROUND' && st.phase !== 'REVEAL') throw new Error('bad_state');
          if (st.game?.category !== 'aufzaehlen') throw new Error('bad_game');
          const allowed = new Set(['neutral', 'correct', 'wrong']);
          if (!allowed.has(status)) throw new Error('bad_status');
          const cells = st.game.cells || [];
          if (index < 0 || index >= cells.length) throw new Error('bad_index');
          if (!cells[index]?.text) throw new Error('empty');
          cells[index].status = status;
          st.game.cells = cells;
          return true;
        });
        safeCb({ ok: true });
      })();
      return;
    }

    // Trifft
    if (event === 'trifft:reserve') {
      const playerId = String(payload?.playerId || '');
      const itemId = String(payload?.itemId || '');
      (async () => {
        let ok = false;
        await updateRoomState(code, (st) => {
          clearExpiredLocks(st);
          if (st.phase !== 'IN_ROUND' || st.locked) throw new Error('locked');
          if (st.game?.category !== 'trifft') throw new Error('bad_game');
          const locks = st.game.locks || {};
          const lock = locks[itemId];
          if (lock && lock.by !== playerId && Number(lock.expiresAt || 0) > Date.now()) {
            throw new Error('already_locked');
          }
          locks[itemId] = { by: playerId, expiresAt: Date.now() + LOCK_TTL_MS };
          st.game.locks = locks;
          ok = true;
          return true;
        });
        safeCb({ ok });
      })();
      return;
    }

    if (event === 'trifft:release') {
      const playerId = String(payload?.playerId || '');
      const itemId = String(payload?.itemId || '');
      (async () => {
        await updateRoomState(code, (st) => {
          if (st.game?.category !== 'trifft') return false;
          const locks = st.game.locks || {};
          const lock = locks[itemId];
          if (lock && (lock.by === playerId || isHost(st, playerId))) {
            locks[itemId] = null;
            st.game.locks = locks;
            return true;
          }
          return false;
        });
        safeCb({ ok: true });
      })();
      return;
    }

    if (event === 'trifft:place') {
      const playerId = String(payload?.playerId || '');
      const itemId = String(payload?.itemId || '');
      const zone = String(payload?.zone || 'pool');
      (async () => {
        await updateRoomState(code, (st) => {
          clearExpiredLocks(st);
          if (st.phase !== 'IN_ROUND' || st.locked) throw new Error('locked');
          if (st.game?.category !== 'trifft') throw new Error('bad_game');
          if (!new Set(['pool', 'zu', 'nicht']).has(zone)) throw new Error('bad_zone');

          const placements = st.game.placements || {};
          if (!(itemId in placements)) throw new Error('bad_item');

          const locks = st.game.locks || {};
          const lock = locks[itemId];
          if (lock && lock.by !== playerId && Number(lock.expiresAt || 0) > Date.now()) {
            throw new Error('not_owner');
          }

          placements[itemId] = zone;
          st.game.placements = placements;
          locks[itemId] = null;
          st.game.locks = locks;

          const it = (st.game.items || []).find((x) => x.id === itemId);
          if (it && zone !== 'pool') addActivity(st, `${playerDisplayName(st, playerId)} legt ${it.name} zu „${zone === 'zu' ? 'Trifft zu' : 'Trifft nicht zu'}“`);
          return true;
        });
        safeCb({ ok: true });
      })();
      return;
    }

    if (event === 'trifft:mark') {
      const playerId = String(payload?.playerId || '');
      const itemId = String(payload?.itemId || '');
      const status = String(payload?.status || 'neutral');
      (async () => {
        await updateRoomState(code, (st) => {
          if (!isHost(st, playerId)) throw new Error('not_host');
          if (st.phase !== 'IN_ROUND') throw new Error('bad_state');
          if (!st.locked) throw new Error('not_locked');
          if (st.game?.category !== 'trifft') throw new Error('bad_game');
          const allowed = new Set(['neutral', 'correct', 'wrong']);
          if (!allowed.has(status)) throw new Error('bad_status');
          const statuses = st.game.statuses || {};
          if (!(itemId in statuses)) throw new Error('bad_item');
          statuses[itemId] = status;
          st.game.statuses = statuses;
          return true;
        });
        safeCb({ ok: true });
      })();
      return;
    }

    // Sortieren
    if (event === 'sort:reserve') {
      const playerId = String(payload?.playerId || '');
      const itemId = String(payload?.itemId || '');
      (async () => {
        let ok = false;
        await updateRoomState(code, (st) => {
          clearExpiredLocks(st);
          if (st.phase !== 'IN_ROUND' || st.locked) throw new Error('locked');
          if (st.game?.category !== 'sortieren') throw new Error('bad_game');
          const locks = st.game.locks || {};
          const lock = locks[itemId];
          if (lock && lock.by !== playerId && Number(lock.expiresAt || 0) > Date.now()) {
            throw new Error('already_locked');
          }
          locks[itemId] = { by: playerId, expiresAt: Date.now() + LOCK_TTL_MS };
          st.game.locks = locks;
          ok = true;
          return true;
        });
        safeCb({ ok });
      })();
      return;
    }

    if (event === 'sort:release') {
      const playerId = String(payload?.playerId || '');
      const itemId = String(payload?.itemId || '');
      (async () => {
        await updateRoomState(code, (st) => {
          if (st.game?.category !== 'sortieren') return false;
          const locks = st.game.locks || {};
          const lock = locks[itemId];
          if (lock && (lock.by === playerId || isHost(st, playerId))) {
            locks[itemId] = null;
            st.game.locks = locks;
            return true;
          }
          return false;
        });
        safeCb({ ok: true });
      })();
      return;
    }

    if (event === 'sort:place') {
      const playerId = String(payload?.playerId || '');
      const itemId = String(payload?.itemId || '');
      const slotIndex = payload?.slotIndex === null || payload?.slotIndex === undefined ? null : Number(payload.slotIndex);
      (async () => {
        await updateRoomState(code, (st) => {
          clearExpiredLocks(st);
          if (st.phase !== 'IN_ROUND' || st.locked) throw new Error('locked');
          if (st.game?.category !== 'sortieren') throw new Error('bad_game');

          if (!(st.game.items || []).some((i) => i.id === itemId)) throw new Error('bad_item');

          const locks = st.game.locks || {};
          const lock = locks[itemId];
          if (lock && lock.by !== playerId && Number(lock.expiresAt || 0) > Date.now()) {
            throw new Error('not_owner');
          }

          // remove from any slot
          const slots = Array.isArray(st.game.slots) ? [...st.game.slots] : [];
          const existingIdx = slots.findIndex((x) => x === itemId);
          if (existingIdx !== -1) slots[existingIdx] = null;

          if (slotIndex !== null) {
            if (slotIndex < 0 || slotIndex >= slots.length) throw new Error('bad_slot');
            slots[slotIndex] = itemId;
            const it = (st.game.items || []).find((i) => i.id === itemId);
            if (it) addActivity(st, `${playerDisplayName(st, playerId)} platziert ${it.name} auf Slot #${slotIndex + 1}`);
          }

          st.game.slots = slots;
          locks[itemId] = null;
          st.game.locks = locks;
          return true;
        });
        safeCb({ ok: true });
      })();
      return;
    }

    // Fakten
    if (event === 'fakten:selectSaboteur') {
      const playerId = String(payload?.playerId || '');
      const saboteurId = String(payload?.saboteurId || '');
      (async () => {
        await updateRoomState(code, (st) => {
          ensureHost(st);
          if (!isHost(st, playerId)) throw new Error('not_host');
          if (st.phase !== 'IN_ROUND') throw new Error('bad_state');
          if (st.game?.category !== 'fakten') throw new Error('bad_game');
          if (st.game.stage !== 'PICK_SABOTEUR') throw new Error('bad_stage');
          if (!(st.players || []).some((p) => p.id === saboteurId)) throw new Error('bad_player');

          st.game.saboteurId = saboteurId;
          st.game.stage = 'SABOTAGE';
          st.game.saboteurReady = false;
          st.game.sabotage = { actionUsed: false, actionType: null, detail: null, snapshotFacts: null };
          st.game.teamPickPokemonId = null;
          st.locked = false;
          return true;
        });
        safeCb({ ok: true });
      })();
      return;
    }

    if (event === 'fakten:sabotage') {
      const playerId = String(payload?.playerId || '');
      const actionType = String(payload?.actionType || '');
      const targetFactId = payload?.targetFactId != null ? String(payload.targetFactId) : null;
      const newText = payload?.text != null ? String(payload.text) : '';
      (async () => {
        await updateRoomState(code, (st) => {
          if (st.phase !== 'IN_ROUND' || st.locked) throw new Error('locked');
          if (st.game?.category !== 'fakten') throw new Error('bad_game');
          if (st.game.stage !== 'SABOTAGE') throw new Error('bad_stage');
          if (st.game.saboteurId !== playerId) throw new Error('not_saboteur');
          if (st.game.sabotage?.actionUsed) throw new Error('already_used');
          if (!new Set(['delete', 'edit', 'add']).has(actionType)) throw new Error('bad_action');

          st.game.sabotage.snapshotFacts = deepClone(st.game.facts || []);
          const snap = st.game.sabotage.snapshotFacts || [];
          const detail = { index: null, oldText: null, newText: null };

          if (actionType === 'delete') {
            if (!targetFactId) throw new Error('bad_target');
            const idx = snap.findIndex((f) => f.id === targetFactId);
            if (idx !== -1) {
              detail.index = idx + 1;
              detail.oldText = snap[idx]?.text ?? null;
            }
            st.game.facts = (st.game.facts || []).filter((f) => f.id !== targetFactId);
          }

          if (actionType === 'edit') {
            if (!targetFactId) throw new Error('bad_target');
            const facts = st.game.facts || [];
            const idx = facts.findIndex((f) => f.id === targetFactId);
            if (idx === -1) throw new Error('bad_target');
            const snapIdx = snap.findIndex((f) => f.id === targetFactId);
            if (snapIdx !== -1) {
              detail.index = snapIdx + 1;
              detail.oldText = snap[snapIdx]?.text ?? null;
            }
            const t = newText.trim().slice(0, 220);
            if (!t) throw new Error('empty');
            detail.newText = t;
            facts[idx] = { ...facts[idx], text: t, appliesToPokemonIds: null };
            st.game.facts = facts;
          }

          if (actionType === 'add') {
            const t = newText.trim().slice(0, 220);
            if (!t) throw new Error('empty');
            detail.index = snap.length + 1;
            detail.newText = t;
            const facts = st.game.facts || [];
            facts.push({ id: randId('fact'), text: t, appliesToPokemonIds: null });
            st.game.facts = facts;
          }

          shuffleInPlace(st.game.facts || []);
          st.game.sabotage.actionUsed = true;
          st.game.sabotage.actionType = actionType;
          st.game.sabotage.detail = detail;
          st.game.saboteurReady = false;
          return true;
        });
        safeCb({ ok: true });
      })();
      return;
    }

    if (event === 'fakten:undo') {
      const playerId = String(payload?.playerId || '');
      (async () => {
        await updateRoomState(code, (st) => {
          if (st.phase !== 'IN_ROUND') throw new Error('bad_state');
          if (st.game?.category !== 'fakten') throw new Error('bad_game');
          if (st.game.stage !== 'SABOTAGE') throw new Error('bad_stage');
          if (st.game.saboteurId !== playerId) throw new Error('not_saboteur');
          if (!st.game.sabotage?.actionUsed) throw new Error('no_action');
          if (!st.game.sabotage.snapshotFacts) throw new Error('no_snapshot');
          st.game.facts = deepClone(st.game.sabotage.snapshotFacts);
          st.game.sabotage = { actionUsed: false, actionType: null, detail: null, snapshotFacts: null };
          st.game.saboteurReady = false;
          return true;
        });
        safeCb({ ok: true });
      })();
      return;
    }

    if (event === 'fakten:hostUndo') {
      const playerId = String(payload?.playerId || '');
      (async () => {
        await updateRoomState(code, (st) => {
          ensureHost(st);
          if (!isHost(st, playerId)) throw new Error('not_host');
          if (st.phase !== 'IN_ROUND') throw new Error('bad_state');
          if (st.game?.category !== 'fakten') throw new Error('bad_game');
          if (st.game.stage !== 'SABOTAGE') throw new Error('bad_stage');
          if (!st.game.sabotage?.actionUsed) throw new Error('no_action');
          if (!st.game.sabotage.snapshotFacts) throw new Error('no_snapshot');
          st.game.facts = deepClone(st.game.sabotage.snapshotFacts);
          st.game.sabotage = { actionUsed: false, actionType: null, detail: null, snapshotFacts: null };
          st.game.saboteurReady = false;
          return true;
        });
        safeCb({ ok: true });
      })();
      return;
    }

    if (event === 'fakten:ready') {
      const playerId = String(payload?.playerId || '');
      (async () => {
        await updateRoomState(code, (st) => {
          if (st.phase !== 'IN_ROUND') throw new Error('bad_state');
          if (st.game?.category !== 'fakten') throw new Error('bad_game');
          if (st.game.stage !== 'SABOTAGE') throw new Error('bad_stage');
          if (st.game.saboteurId !== playerId) throw new Error('not_saboteur');
          if (!st.game.sabotage?.actionUsed) throw new Error('no_action');
          st.game.saboteurReady = true;
          return true;
        });
        safeCb({ ok: true });
      })();
      return;
    }

    if (event === 'fakten:release') {
      const playerId = String(payload?.playerId || '');
      (async () => {
        await updateRoomState(code, (st) => {
          ensureHost(st);
          if (!isHost(st, playerId)) throw new Error('not_host');
          if (st.phase !== 'IN_ROUND') throw new Error('bad_state');
          if (st.game?.category !== 'fakten') throw new Error('bad_game');
          if (st.game.stage !== 'SABOTAGE') throw new Error('bad_stage');
          if (!st.game.saboteurReady) throw new Error('not_ready');

          st.game.stage = 'LIVE';
          st.game.factsText = Array.isArray(st.game.facts) ? st.game.facts.map((f) => f.text) : [];
          st.game.factsRevision = randId('rev');
          st.game.teamPickPokemonId = null;
          st.locked = false;
          return true;
        });
        safeCb({ ok: true });
      })();
      return;
    }

    if (event === 'fakten:pick') {
      const playerId = String(payload?.playerId || '');
      const pokemonId = String(payload?.pokemonId || '');
      (async () => {
        await updateRoomState(code, (st) => {
          if (st.phase !== 'IN_ROUND' || st.locked) throw new Error('locked');
          if (st.game?.category !== 'fakten') throw new Error('bad_game');
          if (st.game.stage !== 'LIVE') throw new Error('bad_stage');
          if (!(st.game.pokemon || []).some((p) => p.id === pokemonId)) throw new Error('bad_pokemon');
          st.game.teamPickPokemonId = st.game.teamPickPokemonId === pokemonId ? null : pokemonId;
          return true;
        });
        safeCb({ ok: true });
      })();
      return;
    }

    // Fehler (if category is enabled in UI later)
    if (event === 'fehler:setImageSize') {
      const w = Number(payload?.w || 0);
      const h = Number(payload?.h || 0);
      (async () => {
        await updateRoomState(code, (st) => {
          if (st.game?.category !== 'fehler') return false;
          st.game.imageWidth = w;
          st.game.imageHeight = h;
          return true;
        });
        safeCb({ ok: true });
      })();
      return;
    }

    if (event === 'fehler:setMarker') {
      const playerId = String(payload?.playerId || '');
      const x = Number(payload?.x);
      const y = Number(payload?.y);
      (async () => {
        await updateRoomState(code, (st) => {
          if (st.phase !== 'IN_ROUND' || st.locked) throw new Error('locked');
          if (st.game?.category !== 'fehler') throw new Error('bad_game');
          st.game.marker = { x, y, by: playerId };
          return true;
        });
        safeCb({ ok: true });
      })();
      return;
    }

    console.warn('[socket] Unknown event:', event);
    safeCb({ ok: false, error: 'unknown_event' });
  },

  // optional compat methods (not used, but harmless)
  connect() { emitLocal('connect'); },
  disconnect() { emitLocal('disconnect'); },
};

