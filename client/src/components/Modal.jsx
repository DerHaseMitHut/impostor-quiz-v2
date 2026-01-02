import React from 'react';

export default function Modal({ title, onClose, children, width = 820 }) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.35)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        zIndex: 1000
      }}
      onMouseDown={onClose}
    >
      <div
        className="card"
        style={{ width: '100%', maxWidth: width, maxHeight: '90vh', overflow: 'auto' }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div style={{ fontWeight: 900, fontSize: 16 }}>{title}</div>
          <button onClick={onClose}>Schließen</button>
        </div>
        <div className="hr" />
        {children}
      </div>
    </div>
  );
}
