import React from 'react';

export default function ActivityFeed({ items, title = 'Aktionen', max = 4 }) {
  const list = (items || []).slice(-max);
  return (
    <div style={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      minHeight: 0,
      borderLeft: '1px solid rgba(0,0,0,0.10)',
      paddingLeft: 12
    }}>
      <div style={{ fontWeight: 900, marginBottom: 6, fontSize: 14 }}>{title}</div>
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        justifyContent: 'flex-end',
        minHeight: 0,
        overflow: 'hidden'
      }}>
        {list.map((it) => (
          <div key={it.id} style={{
            fontSize: 14,
            lineHeight: 1.2,
            opacity: 0.92
          }}>
            {it.text}
          </div>
        ))}
        {!list.length ? <div className="muted" style={{ fontSize: 13 }}>(noch keine Aktionen)</div> : null}
      </div>
    </div>
  );
}
