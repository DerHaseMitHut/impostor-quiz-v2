import React, { useEffect, useCallback, useMemo, useState } from "react";
import { supabase } from "../supabaseClient";

const CAT_LABEL = {
  aufzaehlen: "Aufzählen",
  trifft: "Trifft zu / Trifft nicht zu",
  sortieren: "Sortieren",
  fakten: "Sabotierte Fakten",
};

function uid(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}${Date.now()
    .toString(36)
    .slice(2, 6)}`;
}

function deepClone(x) {
  return JSON.parse(JSON.stringify(x));
}

// ✅ akzeptiert sowohl "neue" Daten (row.data = actualData)
// als auch deinen Import (row.data = { id, name, data: actualData })
function normalizeRoundRow(row) {
  let name = row?.name ?? "";
  let data = row?.data ?? null;

  // Import-Format: { id, name, data: {...} }
  if (data && typeof data === "object" && data.data && typeof data.data === "object") {
    if (!name && typeof data.name === "string") name = data.name;
    data = data.data;
  }

  return {
    id: row.id,
    category: row.category,
    name,
    data,
  };
}

export default function RoundsManager({ socket, me, room }) {
  // socket/me/room bleiben als Props drin (damit du außen nichts ändern musst),
  // werden hier aber nicht mehr für Runden-CRUD benutzt.

  const [cat, setCat] = useState("aufzaehlen");
  const [roundsByCat, setRoundsByCat] = useState({});
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState(null); // {id,name,data}
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  const catKeys = Object.keys(CAT_LABEL);
  const list = roundsByCat?.[cat] || [];

  const makeDefaultData = (category) => {
    if (category === "aufzaehlen") return { question: "", rows: 5, cols: 5 };
    if (category === "trifft") return { thesis: "", items: [] };
    if (category === "sortieren")
      return { axisLeftLabel: "", axisRightLabel: "", items: [], solutionOrder: [] };
    if (category === "fakten") {
      return {
        prompt: "",
        pokemon: [
          { id: uid("pk"), name: "Pokémon 1", imgUrl: "" },
          { id: uid("pk"), name: "Pokémon 2", imgUrl: "" },
          { id: uid("pk"), name: "Pokémon 3", imgUrl: "" },
          { id: uid("pk"), name: "Pokémon 4", imgUrl: "" },
          { id: uid("pk"), name: "Pokémon 5", imgUrl: "" },
          { id: uid("pk"), name: "Pokémon 6", imgUrl: "" },
        ],
        solutionPokemonId: "",
        facts: [
          { id: uid("f"), text: "Fakt 1", appliesToPokemonIds: [] },
          { id: uid("f"), text: "Fakt 2", appliesToPokemonIds: [] },
          { id: uid("f"), text: "Fakt 3", appliesToPokemonIds: [] },
          { id: uid("f"), text: "Fakt 4", appliesToPokemonIds: [] },
          { id: uid("f"), text: "Fakt 5", appliesToPokemonIds: [] },
        ],
      };
    }
    return {};
  };

  const refreshRounds = useCallback(async () => {
  setLoading(true);

  const { data, error } = await supabase
    .from("rounds")
    .select("id,category,name,data")
    .order("category", { ascending: true })
    .order("name", { ascending: true });

  setLoading(false);

  if (error) {
    console.error(error);
    alert("Fehler beim Laden der Runden aus Supabase.");
    return;
  }

  const grouped = {};
  for (const row of data || []) {
    const rr = normalizeRoundRow(row);
    if (!grouped[rr.category]) grouped[rr.category] = [];
    grouped[rr.category].push(rr);
  }
  setRoundsByCat(grouped);
}, []);


  // initial load
  useEffect(() => {
    refreshRounds();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  
  //
  useEffect(() => {
  console.log("REALTIME rounds: init");

  const channel = supabase
    .channel("rounds-changes")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "rounds" },
      (payload) => {
        console.log("REALTIME rounds: payload", payload);
        refreshRounds();
      }
    )
    .subscribe((status) => {
      console.log("REALTIME rounds: status", status);
    });

  return () => {
    console.log("REALTIME rounds: cleanup");
    supabase.removeChannel(channel);
  };
}, [refreshRounds]);

  // Auswahl sauber halten
  useEffect(() => {
    const newList = roundsByCat?.[cat] || [];
    if (!newList.length) {
      setSelectedId("");
      setDraft(null);
      return;
    }
    if (!selectedId || !newList.some((r) => r.id === selectedId)) {
      setSelectedId(newList[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cat, roundsByCat]);

  // Draft laden
  useEffect(() => {
    if (!selectedId) {
      setDraft(null);
      return;
    }
    const meta = (roundsByCat?.[cat] || []).find((r) => r.id === selectedId);
    if (!meta) {
      setDraft(null);
      return;
    }
    setDraft({
      id: meta.id,
      name: meta.name,
      data: deepClone(meta.data ?? makeDefaultData(cat)),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, cat, roundsByCat]);

  const createNew = async () => {
    const id = uid(`r_${cat}`);
    const next = { id, name: "Neue Runde", data: makeDefaultData(cat) };

    setStatus("Erstelle...");
    const { error } = await supabase
      .from("rounds")
      .upsert(
        { id: next.id, category: cat, name: next.name, data: next.data }, // ✅ speichert NUR die echten Daten
        { onConflict: "id" }
      );

    if (error) {
      console.error(error);
      setStatus("Fehler beim Erstellen.");
      setTimeout(() => setStatus(""), 1200);
      return;
    }

    await refreshRounds();
    setSelectedId(id);
    setDraft(next);

    setStatus("Erstellt ✔");
    setTimeout(() => setStatus(""), 900);
  };

  const save = async () => {
    if (!draft?.id || !draft?.name) return;

    setStatus("Speichere...");
    const { error } = await supabase
      .from("rounds")
      .upsert(
        { id: draft.id, category: cat, name: draft.name, data: draft.data }, // ✅ speichert NUR die echten Daten
        { onConflict: "id" }
      );

    if (error) {
      console.error(error);
      setStatus("Fehler beim Speichern.");
      setTimeout(() => setStatus(""), 1200);
      return;
    }

    await refreshRounds();
    setStatus("Gespeichert ✔");
    setTimeout(() => setStatus(""), 900);
  };

  const del = async () => {
    if (!selectedId) return;
    // eslint-disable-next-line no-restricted-globals
    if (!confirm("Diese Runde löschen?")) return;

    setStatus("Lösche...");
    const { error } = await supabase.from("rounds").delete().eq("id", selectedId);

    if (error) {
      console.error(error);
      setStatus("Fehler beim Löschen.");
      setTimeout(() => setStatus(""), 1200);
      return;
    }

    setSelectedId("");
    setDraft(null);
    await refreshRounds();

    setStatus("Gelöscht ✔");
    setTimeout(() => setStatus(""), 900);
  };

  return (
    <div className="grid" style={{ gap: 12 }}>
      <div className="row" style={{ flexWrap: "wrap", justifyContent: "space-between" }}>
        <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
          <span className="pill">Kategorie</span>
          <select value={cat} onChange={(e) => setCat(e.target.value)}>
            {catKeys.map((k) => (
              <option key={k} value={k}>
                {CAT_LABEL[k]}
              </option>
            ))}
          </select>

          <span className="pill">Runde</span>
          <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
            {list.length ? (
              list.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))
            ) : (
              <option value="">{loading ? "(lädt...)" : "(keine)"}</option>
            )}
          </select>

          <button onClick={createNew}>Neu</button>
          <button disabled={!draft} onClick={save}>
            Speichern
          </button>
          <button disabled={!selectedId} onClick={del}>
            Löschen
          </button>
        </div>

        <div className="row" style={{ gap: 10, alignItems: "center" }}>
          {loading ? <span className="muted">lädt...</span> : null}
          {status ? <span className="badge">{status}</span> : null}
        </div>
      </div>

      {!draft ? (
        <div className="muted">Wähle eine Runde oder erstelle eine neue.</div>
      ) : (
        <div className="grid" style={{ gap: 12 }}>
          <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <label>
              <div className="pill" style={{ marginBottom: 6 }}>
                Runden-ID
              </div>
              <input value={draft.id} readOnly />
            </label>
            <label>
              <div className="pill" style={{ marginBottom: 6 }}>
                Name
              </div>
              <input
                value={draft.name}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              />
            </label>
          </div>

          {cat === "aufzaehlen" ? <AufzaehlenEditor draft={draft} setDraft={setDraft} /> : null}
          {cat === "trifft" ? <TrifftEditor draft={draft} setDraft={setDraft} /> : null}
          {cat === "sortieren" ? <SortEditor draft={draft} setDraft={setDraft} /> : null}
          {cat === "fakten" ? <FaktenEditor draft={draft} setDraft={setDraft} /> : null}
        </div>
      )}
    </div>
  );
}

/* === EDITORS (unverändert) === */

function AufzaehlenEditor({ draft, setDraft }) {
  const data = draft.data;
  return (
    <div className="card">
      <div style={{ fontWeight: 900, marginBottom: 10 }}>Aufzählen</div>
      <div className="grid" style={{ gap: 10 }}>
        <label>
          <div className="pill" style={{ marginBottom: 6 }}>Frage</div>
          <textarea
            rows={2}
            value={data.question || ""}
            onChange={(e) =>
              setDraft((d) => ({ ...d, data: { ...d.data, question: e.target.value } }))
            }
          />
        </label>
        <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <label>
            <div className="pill" style={{ marginBottom: 6 }}>Zeilen</div>
            <input
              type="number"
              min={1}
              max={12}
              value={data.rows ?? 5}
              onChange={(e) =>
                setDraft((d) => ({ ...d, data: { ...d.data, rows: Number(e.target.value) } }))
              }
            />
          </label>
          <label>
            <div className="pill" style={{ marginBottom: 6 }}>Spalten</div>
            <input
              type="number"
              min={1}
              max={12}
              value={data.cols ?? 5}
              onChange={(e) =>
                setDraft((d) => ({ ...d, data: { ...d.data, cols: Number(e.target.value) } }))
              }
            />
          </label>
        </div>
      </div>
    </div>
  );
}

function TrifftEditor({ draft, setDraft }) {
  const data = draft.data;
  const items = Array.isArray(data.items) ? data.items : [];

  const add = () => {
    const it = { id: uid("p"), name: "Pokémon", imgUrl: "" };
    setDraft((d) => ({ ...d, data: { ...d.data, items: [...items, it] } }));
  };

  const update = (idx, patch) => {
    const next = items.map((it, i) => (i === idx ? { ...it, ...patch } : it));
    setDraft((d) => ({ ...d, data: { ...d.data, items: next } }));
  };

  const remove = (idx) => {
    const next = items.filter((_, i) => i !== idx);
    setDraft((d) => ({ ...d, data: { ...d.data, items: next } }));
  };

  return (
    <div className="card">
      <div style={{ fontWeight: 900, marginBottom: 10 }}>Trifft zu / Trifft nicht zu</div>
      <label>
        <div className="pill" style={{ marginBottom: 6 }}>These</div>
        <textarea
          rows={3}
          value={data.thesis || ""}
          onChange={(e) =>
            setDraft((d) => ({ ...d, data: { ...d.data, thesis: e.target.value } }))
          }
        />
      </label>
      <div className="hr" />
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div className="muted">Items (10 empfohlen)</div>
        <button onClick={add}>+ Item</button>
      </div>
      <div className="grid" style={{ gap: 10, marginTop: 10 }}>
        {items.map((it, idx) => (
          <div
            key={it.id}
            className="grid"
            style={{ gridTemplateColumns: "120px 1fr 1fr 90px", gap: 10, alignItems: "center" }}
          >
            <div className="badge" title="Item-ID">{it.id}</div>
            <input value={it.name} onChange={(e) => update(idx, { name: e.target.value })} placeholder="Name" />
            <input value={it.imgUrl} onChange={(e) => update(idx, { imgUrl: e.target.value })} placeholder="Bild-URL (Sprite)" />
            <button onClick={() => remove(idx)}>Entf.</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function FaktenEditor({ draft, setDraft }) {
  const data = draft.data || {};
  const pokemon = Array.isArray(data.pokemon) ? data.pokemon : [];
  const facts = Array.isArray(data.facts) ? data.facts : [];

  const addPokemon = () => {
    const pk = { id: uid("pk"), name: `Pokémon ${pokemon.length + 1}`, imgUrl: "" };
    setDraft((d) => ({ ...d, data: { ...d.data, pokemon: [...pokemon, pk] } }));
  };

  const updatePokemon = (idx, patch) => {
    const next = pokemon.map((p, i) => (i === idx ? { ...p, ...patch } : p));
    setDraft((d) => ({ ...d, data: { ...d.data, pokemon: next } }));
  };

  const removePokemon = (idx) => {
    const removed = pokemon[idx];
    const nextPokemon = pokemon.filter((_, i) => i !== idx);
    const nextFacts = facts.map((f) => {
      const arr = Array.isArray(f.appliesToPokemonIds) ? f.appliesToPokemonIds : [];
      return { ...f, appliesToPokemonIds: arr.filter((id) => id !== removed?.id) };
    });
    const nextSolution = data.solutionPokemonId === removed?.id ? "" : data.solutionPokemonId;
    setDraft((d) => ({
      ...d,
      data: { ...d.data, pokemon: nextPokemon, facts: nextFacts, solutionPokemonId: nextSolution },
    }));
  };

  const addFact = () => {
    const f = { id: uid("f"), text: `Fakt ${facts.length + 1}`, appliesToPokemonIds: [] };
    setDraft((d) => ({ ...d, data: { ...d.data, facts: [...facts, f] } }));
  };

  const updateFact = (idx, patch) => {
    const next = facts.map((f, i) => (i === idx ? { ...f, ...patch } : f));
    setDraft((d) => ({ ...d, data: { ...d.data, facts: next } }));
  };

  const removeFact = (idx) => {
    const next = facts.filter((_, i) => i !== idx);
    setDraft((d) => ({ ...d, data: { ...d.data, facts: next } }));
  };

  const toggleApply = (factIdx, pokemonId) => {
    const f = facts[factIdx];
    const cur = Array.isArray(f.appliesToPokemonIds) ? f.appliesToPokemonIds : [];
    const has = cur.includes(pokemonId);
    const next = has ? cur.filter((id) => id !== pokemonId) : [...cur, pokemonId];
    updateFact(factIdx, { appliesToPokemonIds: next });
  };

  return (
    <div className="card">
      <div style={{ fontWeight: 900, marginBottom: 10 }}>Sabotierte Fakten</div>

      <label>
        <div className="pill" style={{ marginBottom: 6 }}>Prompt / Frage (optional)</div>
        <textarea
          rows={2}
          value={data.prompt || ""}
          onChange={(e) => setDraft((d) => ({ ...d, data: { ...d.data, prompt: e.target.value } }))}
        />
      </label>

      <div className="hr" />

      <div className="row" style={{ justifyContent: "space-between" }}>
        <div className="muted">Pokémon (6 empfohlen)</div>
        <button onClick={addPokemon}>+ Pokémon</button>
      </div>

      <div className="grid" style={{ gap: 10, marginTop: 10 }}>
        {pokemon.map((p, idx) => (
          <div
            key={p.id}
            className="grid"
            style={{ gridTemplateColumns: "120px 1fr 1fr 90px", gap: 10, alignItems: "center" }}
          >
            <div className="badge" title="Pokémon-ID">{p.id}</div>
            <input value={p.name || ""} onChange={(e) => updatePokemon(idx, { name: e.target.value })} placeholder="Name" />
            <input value={p.imgUrl || ""} onChange={(e) => updatePokemon(idx, { imgUrl: e.target.value })} placeholder="Bild-URL" />
            <button onClick={() => removePokemon(idx)}>Entf.</button>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 10 }}>
        <label>
          <div className="pill" style={{ marginBottom: 6 }}>Lösung (Pokémon-ID)</div>
          <select
            value={data.solutionPokemonId || ""}
            onChange={(e) =>
              setDraft((d) => ({ ...d, data: { ...d.data, solutionPokemonId: e.target.value } }))
            }
          >
            <option value="">(bitte wählen)</option>
            {pokemon.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} — {p.id}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="hr" />

      <div className="row" style={{ justifyContent: "space-between" }}>
        <div className="muted">Fakten (Mapping nur für Saboteur-Hover)</div>
        <button onClick={addFact}>+ Fakt</button>
      </div>

      <div className="grid" style={{ gap: 10, marginTop: 10 }}>
        {facts.map((f, idx) => (
          <div
            key={f.id}
            style={{ border: "1px solid rgba(0,0,0,0.12)", borderRadius: 14, padding: 12, background: "#fff" }}
          >
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 10 }}>
              <div className="badge" title="Fakt-ID">{f.id}</div>
              <button onClick={() => removeFact(idx)}>Entf.</button>
            </div>
            <textarea
              rows={2}
              style={{ marginTop: 8 }}
              value={f.text || ""}
              onChange={(e) => updateFact(idx, { text: e.target.value })}
              placeholder="Fakt"
            />
            <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
              Trifft zu auf (Hover-Markierung beim Saboteur):
            </div>
            <div className="row" style={{ flexWrap: "wrap", gap: 8, marginTop: 6 }}>
              {pokemon.length ? (
                pokemon.map((p) => {
                  const cur = Array.isArray(f.appliesToPokemonIds) ? f.appliesToPokemonIds : [];
                  const checked = cur.includes(p.id);
                  return (
                    <label key={p.id} className="row" style={{ gap: 6, alignItems: "center" }}>
                      <input type="checkbox" checked={checked} onChange={() => toggleApply(idx, p.id)} />
                      <span>{p.name}</span>
                    </label>
                  );
                })
              ) : (
                <span className="muted">(erst Pokémon anlegen)</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SortEditor({ draft, setDraft }) {
  const data = draft.data;
  const items = Array.isArray(data.items) ? data.items : [];
  const solutionOrder = Array.isArray(data.solutionOrder) ? data.solutionOrder : [];

  const moveSolutionTo = (itemId, newPos) => {
    const pos = Math.max(1, Math.min(items.length, Number(newPos) || 1));
    const next = solutionOrder.filter((id) => id !== itemId);
    next.splice(pos - 1, 0, itemId);
    for (const it of items) if (!next.includes(it.id)) next.push(it.id);
    setDraft((d) => ({ ...d, data: { ...d.data, solutionOrder: next } }));
  };

  const add = () => {
    const it = { id: uid("s"), name: "Pokémon", imgUrl: "" };
    setDraft((d) => ({
      ...d,
      data: { ...d.data, items: [...items, it], solutionOrder: [...solutionOrder, it.id] },
    }));
  };

  const update = (idx, patch) => {
    const next = items.map((it, i) => (i === idx ? { ...it, ...patch } : it));
    setDraft((d) => ({ ...d, data: { ...d.data, items: next } }));
  };

  const remove = (idx) => {
    const removed = items[idx];
    const nextItems = items.filter((_, i) => i !== idx);
    const nextOrder = solutionOrder.filter((id) => id !== removed.id);
    setDraft((d) => ({ ...d, data: { ...d.data, items: nextItems, solutionOrder: nextOrder } }));
  };

  const useItemOrder = () => {
    setDraft((d) => ({ ...d, data: { ...d.data, solutionOrder: items.map((i) => i.id) } }));
  };

  return (
    <div className="card">
      <div style={{ fontWeight: 900, marginBottom: 10 }}>Sortieren</div>
      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <label>
          <div className="pill" style={{ marginBottom: 6 }}>Linkes Label</div>
          <input
            value={data.axisLeftLabel || ""}
            onChange={(e) =>
              setDraft((d) => ({ ...d, data: { ...d.data, axisLeftLabel: e.target.value } }))
            }
          />
        </label>
        <label>
          <div className="pill" style={{ marginBottom: 6 }}>Rechtes Label</div>
          <input
            value={data.axisRightLabel || ""}
            onChange={(e) =>
              setDraft((d) => ({ ...d, data: { ...d.data, axisRightLabel: e.target.value } }))
            }
          />
        </label>
      </div>

      <div className="hr" />
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div className="muted">Items (N Slots)</div>
        <div className="row" style={{ gap: 8 }}>
          <button onClick={add}>+ Item</button>
          <button onClick={useItemOrder}>Lösung = Item-Reihenfolge</button>
        </div>
      </div>

      <div className="grid" style={{ gap: 10, marginTop: 10 }}>
        {items.map((it, idx) => {
          const pos = solutionOrder.indexOf(it.id) + 1;
          return (
            <div
              key={it.id}
              className="grid"
              style={{ gridTemplateColumns: "120px 110px 1fr 1fr 90px", gap: 10, alignItems: "center" }}
            >
              <div className="badge" title="Item-ID">{it.id}</div>

              <label style={{ display: "grid", gap: 4 }}>
                <div className="muted" style={{ fontSize: 12 }}>Platz</div>
                <select value={pos || 1} onChange={(e) => moveSolutionTo(it.id, Number(e.target.value))}>
                  {Array.from({ length: Math.max(1, items.length) }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </label>

              <input value={it.name} onChange={(e) => update(idx, { name: e.target.value })} placeholder="Name" />
              <input value={it.imgUrl} onChange={(e) => update(idx, { imgUrl: e.target.value })} placeholder="Bild-URL" />
              <button onClick={() => remove(idx)}>Entf.</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
