import React, { useEffect, useMemo, useRef, useState } from 'react';
import { resolveAsset } from '../socket';

function useObservedSize() {
  const [el, setEl] = useState(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    if (!el) return;

    const read = () => {
      const r = el.getBoundingClientRect();
      setSize({ w: r.width, h: r.height });
    };

    read();

    const ro = new ResizeObserver(() => read());
    ro.observe(el);
    window.addEventListener('resize', read);

    return () => {
      ro.disconnect();
      window.removeEventListener('resize', read);
    };
  }, [el]);

  return [setEl, size];
}

function fitContain(boxW, boxH, imgW, imgH) {
  const bw = Number(boxW) || 0;
  const bh = Number(boxH) || 0;
  const iw = Number(imgW) || 0;
  const ih = Number(imgH) || 0;
  if (!bw || !bh || !iw || !ih) {
    return { offsetX: 0, offsetY: 0, drawW: 0, drawH: 0, minDim: 0 };
  }
  const scale = Math.min(bw / iw, bh / ih);
  const drawW = iw * scale;
  const drawH = ih * scale;
  const offsetX = (bw - drawW) / 2;
  const offsetY = (bh - drawH) / 2;
  return { offsetX, offsetY, drawW, drawH, minDim: Math.min(drawW, drawH) };
}

function CircleOverlay({ x, y, rFrac, boxSize, imgSize, title, border, fill, shadow }) {
  if (x == null || y == null) return null;
  const fit = fitContain(boxSize.w, boxSize.h, imgSize.w, imgSize.h);
  if (!fit.minDim) return null;

  // IMPORTANT: radius is defined relative to the rendered image area (object-fit: contain),
  // not the full box.
  const radiusPx = Math.max(2, rFrac * fit.minDim);
  const diameterPx = radiusPx * 2;
  const leftPx = fit.offsetX + x * fit.drawW;
  const topPx = fit.offsetY + y * fit.drawH;

  return (
    <div
      title={title || ''}
      style={{
        position: 'absolute',
        left: `${leftPx}px`,
        top: `${topPx}px`,
        width: `${diameterPx}px`,
        height: `${diameterPx}px`,
        transform: 'translate(-50%, -50%)',
        borderRadius: 9999,
        border,
        background: fill || 'transparent',
        boxShadow: shadow || 'none',
        pointerEvents: 'none'
      }}
    />
  );
}

function CenterDot({ x, y, boxSize, imgSize, color = 'rgba(0,0,0,0.8)', label }) {
  if (x == null || y == null) return null;
  const fit = fitContain(boxSize.w, boxSize.h, imgSize.w, imgSize.h);
  if (!fit.minDim) return null;
  const leftPx = fit.offsetX + x * fit.drawW;
  const topPx = fit.offsetY + y * fit.drawH;
  return (
    <div
      title={label || ''}
      style={{
        position: 'absolute',
        left: `${leftPx}px`,
        top: `${topPx}px`,
        width: 8,
        height: 8,
        transform: 'translate(-50%, -50%)',
        borderRadius: 9999,
        background: color,
        boxShadow: '0 0 0 2px rgba(255,255,255,0.85)',
        pointerEvents: 'none'
      }}
    />
  );
}

function CenterLine({ a, b, boxSize, imgSize }) {
  if (!a || !b) return null;
  const fit = fitContain(boxSize.w, boxSize.h, imgSize.w, imgSize.h);
  if (!fit.minDim) return null;
  const ax = fit.offsetX + a.x * fit.drawW;
  const ay = fit.offsetY + a.y * fit.drawH;
  const bx = fit.offsetX + b.x * fit.drawW;
  const by = fit.offsetY + b.y * fit.drawH;
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy);
  const angle = Math.atan2(dy, dx);
  return (
    <div
      style={{
        position: 'absolute',
        left: ax,
        top: ay,
        width: len,
        height: 2,
        transformOrigin: '0 50%',
        transform: `translateY(-50%) rotate(${angle}rad)`,
        background: 'rgba(0,0,0,0.35)',
        pointerEvents: 'none'
      }}
    />
  );
}

export default function FehlerFindenGame({ socket, me, room }) {
  const game = room.game;
  const isRound = room.phase === 'IN_ROUND';
  const canClick = isRound && !room.locked;

  const errorUrl = resolveAsset(game.errorImageUrl);
  const correctUrl = resolveAsset(game.correctImageUrl);

  // Use the image's *real* intrinsic size for correct object-fit contain math.
  // (Editor sliders are helpful, but the actual image aspect ratio must be respected.)
  const [errorImgSize, setErrorImgSize] = useState({ w: game.imageWidth || 0, h: game.imageHeight || 0 });
  const lastReportedSize = useRef({ w: 0, h: 0 });

  const reportImageSize = (w, h) => {
    if (!socket || !room?.code || !me?.playerId) return;
    if (!w || !h) return;
    const lw = lastReportedSize.current.w;
    const lh = lastReportedSize.current.h;
    if (Math.abs(lw - w) < 0.5 && Math.abs(lh - h) < 0.5) return;
    lastReportedSize.current = { w, h };
    socket.emit('fehler:setImageSize', { code: room.code, playerId: me.playerId, w, h }, () => {});
  };

  // Radius is stored as fraction of min(imageWidth, imageHeight).
  // IMPORTANT: team marker and solution circle must match in size.
  const markerR = useMemo(() => (game.solution?.r ?? 0.1), [game.solution?.r]);

  const [roundBoxRef, roundBoxSize] = useObservedSize();
  const [revealErrorRef, revealErrorSize] = useObservedSize();

  const onClickImg = (e) => {
    if (!canClick) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const bx = e.clientX - rect.left;
    const by = e.clientY - rect.top;
    const fit = fitContain(rect.width, rect.height, errorImgSize.w, errorImgSize.h);
    if (!fit.minDim) return;
    const localX = (bx - fit.offsetX) / fit.drawW;
    const localY = (by - fit.offsetY) / fit.drawH;
    // ignore clicks in the letterbox area
    if (localX < 0 || localX > 1 || localY < 0 || localY > 1) return;
    const x = localX;
    const y = localY;
    socket.emit('fehler:setMarker', { code: room.code, playerId: me.playerId, x, y }, () => {});
  };

  return (
    <div
      className="grid"
      style={{
        gap: 12,
        height: '100%',
        // Row 1: images, Row 2: footer/result
        gridTemplateRows: room.phase === 'REVEAL' ? '1fr auto' : '1fr',
        minHeight: 0
      }}
    >
      {room.phase === 'IN_ROUND' ? (
        <div style={{ display: 'grid', placeItems: 'center', minHeight: 0 }}>
          <div
            ref={roundBoxRef}
            style={{
              position: 'relative',
              width: '100%',
              maxWidth: 1100,
              aspectRatio: '1 / 1',
              height: 'min(100%, 720px)',
              borderRadius: 16,
              overflow: 'hidden',
              border: '1px solid rgba(0,0,0,0.12)'
            }}
          >
            <img
              src={errorUrl}
              alt="Fehlerbild"
              onClick={onClickImg}
              onLoad={(e) => {
                const img = e.currentTarget;
                const nw = img.naturalWidth || 0;
                const nh = img.naturalHeight || 0;
                if (nw && nh) {
                  setErrorImgSize({ w: nw, h: nh });
                  reportImageSize(nw, nh);
                }
              }}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'contain',
                display: 'block',
                cursor: canClick ? 'crosshair' : 'default',
                background: 'rgba(0,0,0,0.03)'
              }}
            />

            {game.marker ? (
              <CircleOverlay
                x={game.marker.x}
                y={game.marker.y}
                rFrac={markerR}
                boxSize={roundBoxSize}
                imgSize={errorImgSize}
                title="Team-Marker"
                border="3px solid rgba(0,0,0,0.65)"
                fill="rgba(59,130,246,0.12)"
              />
            ) : null}

            {game.marker ? (
              <CenterDot x={game.marker.x} y={game.marker.y} boxSize={roundBoxSize} imgSize={errorImgSize} label="Center (Team)" />
            ) : null}
          </div>
        </div>
      ) : null}

      {room.phase === 'REVEAL' ? (
        <>
          {/*
            IMPORTANT: The image row is 1fr. If the image box uses width-based sizing (aspectRatio),
            it can overflow into the footer. We therefore size the boxes by the available row height.
          */}
          <div style={{ display: 'flex', gap: 12, alignItems: 'stretch', minHeight: 0, height: '100%', overflow: 'hidden' }}>
            <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', alignItems: 'stretch' }}>
              <div
                ref={revealErrorRef}
                style={{
                  position: 'relative',
                  borderRadius: 16,
                  overflow: 'hidden',
                  border: '1px solid rgba(0,0,0,0.12)',
                  width: '100%',
                  height: '100%',
                  minHeight: 0
                }}
              >
                <img
                  src={errorUrl}
                  alt="Fehlerbild"
                  onLoad={(e) => {
                    const img = e.currentTarget;
                    const nw = img.naturalWidth || 0;
                    const nh = img.naturalHeight || 0;
                if (nw && nh) {
                  setErrorImgSize({ w: nw, h: nh });
                  reportImageSize(nw, nh);
                }
                  }}
                  style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block', background: 'rgba(0,0,0,0.03)' }}
                />

                {game.marker ? (
                  <CircleOverlay
                    x={game.marker.x}
                    y={game.marker.y}
                    rFrac={markerR}
                    boxSize={revealErrorSize}
                    imgSize={errorImgSize}
                    title="Euer Marker"
                    border="3px solid rgba(0,0,0,0.65)"
                    fill="rgba(59,130,246,0.12)"
                  />
                ) : null}

                <CircleOverlay
                  x={game.solution?.x}
                  y={game.solution?.y}
                  rFrac={markerR}
                  boxSize={revealErrorSize}
                  imgSize={errorImgSize}
                  title="Lösung"
                  border="4px solid rgba(34,197,94,0.88)"
                  shadow="0 0 0 10px rgba(34,197,94,0.18)"
                />

                <CenterLine a={game.marker} b={game.solution} boxSize={revealErrorSize} imgSize={errorImgSize} />
                <CenterDot x={game.solution?.x} y={game.solution?.y} boxSize={revealErrorSize} imgSize={errorImgSize} color="rgba(34,197,94,0.95)" label="Center (Lösung)" />
                {game.marker ? (
                  <CenterDot x={game.marker.x} y={game.marker.y} boxSize={revealErrorSize} imgSize={errorImgSize} label="Center (Team)" />
                ) : null}
              </div>
            </div>

            <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', alignItems: 'stretch' }}>
              <div
                style={{
                  borderRadius: 16,
                  overflow: 'hidden',
                  border: '1px solid rgba(0,0,0,0.12)',
                  width: '100%',
                  height: '100%',
                  minHeight: 0
                }}
              >
                <img
                  src={correctUrl}
                  alt="Richtiges Bild"
                  style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block', background: 'rgba(0,0,0,0.03)' }}
                />
              </div>
            </div>
          </div>

          <div style={{ border: '1px solid rgba(0,0,0,0.12)', borderRadius: 16, padding: 12, background: '#fff' }}>
            {game.result ? (
              <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
                <div style={{ fontSize: 20, fontWeight: 950 }}>
                  {game.result.win ? '✅ Treffer! Team gewinnt.' : '❌ Leider daneben.'}
                </div>
                <div className="muted" style={{ fontSize: 13 }}>
                  {(() => {
                    // We expect normalized units (0..1). If we ever get pixel values
                    // (legacy), convert them using the current rendered min dimension.
                    const min = Math.min(revealErrorSize.w || 0, revealErrorSize.h || 0) || 1;
                    const fit = fitContain(revealErrorSize.w || 0, revealErrorSize.h || 0, errorImgSize.w, errorImgSize.h);
                    const minImg = fit.minDim || min;
                    const rawDist = Number(game.result.distance ?? game.result.distanceNorm ?? game.result.distancePx);
                    const rawRad = Number(game.result.radius ?? game.result.radiusNorm ?? game.result.thresholdPx ?? game.solution?.r);
                    const distNorm = rawDist > 1 ? rawDist / min : rawDist;
                    const radNorm = rawRad > 1 ? rawRad / min : rawRad;
                    const distPx = distNorm * minImg;
                    const radPx = radNorm * minImg;
                    const clientWin = distNorm < radNorm;
                    const cfgR = Number(game.solution?.r ?? NaN);

                    return (
                      <>
                        d={distNorm.toFixed(4)} ({(distNorm * 100).toFixed(2)}%) / r={radNorm.toFixed(4)} ({(radNorm * 100).toFixed(2)}%)
                        {' • '}
                        px: d={distPx.toFixed(1)} / r={radPx.toFixed(1)}
                        {isFinite(cfgR) ? <> {' • '}cfg r={cfgR.toFixed(3)}</> : null}
                        {clientWin === Boolean(game.result.win) ? null : (
                          <> {' • '}⚠️ mismatch (client {clientWin ? 'hit' : 'miss'})</>
                        )}
                      </>
                    );
                  })()}
                </div>
              </div>
            ) : (
              <div className="muted">(kein Ergebnis)</div>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
