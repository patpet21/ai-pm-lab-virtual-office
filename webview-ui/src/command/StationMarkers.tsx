import type { MutableRefObject } from 'react';
import { useEffect, useRef } from 'react';

import type { OfficeState } from '../office/engine/officeState';
import { overlayProjection } from '../office/projection';
import { TILE_SIZE } from '../office/types';
import { stationSeats } from './stations';

export function StationMarkers({
  office,
  zoom,
  panRef,
}: {
  office: OfficeState;
  zoom: number;
  panRef: MutableRefObject<{ x: number; y: number }>;
}) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      const parent = root.current?.parentElement;
      const canvas = parent?.querySelector('canvas');
      if (canvas && root.current && parent) {
        const layout = office.getLayout();
        const rect = canvas.getBoundingClientRect();
        const projection = overlayProjection(
          layout,
          rect,
          zoom,
          panRef.current,
          window.devicePixelRatio || 1,
        );
        for (const marker of root.current.children) (marker as HTMLElement).style.display = 'none';
        stationSeats(office).forEach((seat, index) => {
          const element = root.current?.children[index] as HTMLElement | undefined;
          if (element) {
            element.style.display = 'block';
            element.style.transform = `translate(${projection.toScreenX((seat.seatCol + 0.5) * TILE_SIZE)}px, ${projection.toScreenY((seat.seatRow + 0.5) * TILE_SIZE) - 28}px) translateX(-50%)`;
          }
        });
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [office, zoom, panRef]);
  return (
    <div ref={root} className="station-markers" aria-hidden="true">
      <span>01 · Discovery</span>
      <span>02 · Intelligence</span>
      <span>03 · Readiness</span>
    </div>
  );
}
