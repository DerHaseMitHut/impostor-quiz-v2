import React from 'react';
import AufzaehlenGame from '../games/AufzaehlenGame.jsx';
import TrifftGame from '../games/TrifftGame.jsx';
import SortierenGame from '../games/SortierenGame.jsx';
import FaktenGame from '../games/FaktenGame.jsx';

const CAT_LABEL = {
  aufzaehlen: 'Aufzählen',
  trifft: 'Trifft zu / Trifft nicht zu',
  sortieren: 'Sortieren',
  fakten: 'Sabotierte Fakten'
};

function HubScreen({ room }) {
  return (
    <div className="stageInner">
      <div className="stageCenter" style={{ flex: 1 }}>
        <div style={{ fontSize: 56, fontWeight: 950, letterSpacing: -0.7 }}>Warte auf nächste Runde</div>
      </div>
    </div>
  );
}

export default function GameRenderer({ socket, me, room }) {
  if (!room) return <div className="muted">Verbinde...</div>;
  if (room.phase === 'HUB' || !room.game) return <HubScreen room={room} />;

  const cat = room.game.category;
  const title = CAT_LABEL[cat] || cat;

  return (
    <div className="stageInner">
      <div className="stageHeader">
        <div style={{ fontWeight: 950, fontSize: 26, letterSpacing: -0.4 }}>{title}</div>
      </div>

      <div className="stageBody">
        {cat === 'aufzaehlen' ? <AufzaehlenGame socket={socket} me={me} room={room} /> : null}
        {cat === 'trifft' ? <TrifftGame socket={socket} me={me} room={room} /> : null}
        {cat === 'sortieren' ? <SortierenGame socket={socket} me={me} room={room} /> : null}
        {cat === 'fakten' ? <FaktenGame socket={socket} me={me} room={room} /> : null}

        {cat !== 'aufzaehlen' && cat !== 'trifft' && cat !== 'sortieren' && cat !== 'fakten' ? (
          <div className="muted">Unbekannte Kategorie: {cat}</div>
        ) : null}
      </div>
    </div>
  );
}
