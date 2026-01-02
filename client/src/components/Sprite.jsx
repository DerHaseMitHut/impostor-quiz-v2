import React, { useMemo } from 'react';
import { resolveAsset } from '../socket';

/**
 * Sprite image helper.
 * We keep default rendering (no forced pixelation), because stream viewers usually prefer
 * smoother scaling over crunchy pixelated upscaling.
 */
// Props:
// - size: number (px). Default 64.
// - fill: boolean. If true, the image stretches to fill its parent (100%/100%).
// - fit: CSS object-fit (contain|cover). Default 'contain'.
export default function Sprite({ src, alt, size = 64, fill = false, fit = 'contain', style = {}, className = '' }) {
  const resolved = useMemo(() => (src ? resolveAsset(src) : ''), [src]);

  if (!resolved) return null;

  return (
    <img
      src={resolved}
      alt={alt}
      width={fill ? undefined : size}
      height={fill ? undefined : size}
      className={className}
      style={{
        width: fill ? '100%' : size,
        height: fill ? '100%' : size,
        objectFit: fit,
        imageRendering: 'auto',
        ...style
      }}
    />
  );
}
