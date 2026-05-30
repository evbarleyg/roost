import { CircleMarker, MapContainer, TileLayer, Tooltip } from "react-leaflet";

import { scoreColor } from "../lib/colors";
import { money } from "../lib/format";
import { derive } from "../scoring";
import { useStore } from "../store";
import type { Listing } from "../types";

// Score-colored markers + a pinned anchor at 500 Howard. CircleMarker avoids the
// classic Leaflet "missing default marker icon" bundler headache entirely.
export function MapView({ rows }: { rows: Listing[] }) {
  const settings = useStore((s) => s.settings)!;
  const select = useStore((s) => s.select);
  const [alat, alng] = settings.anchor_latlng;

  const placed = rows.filter((l) => l.lat != null && l.lng != null);
  const missing = rows.length - placed.length;

  return (
    <div className="relative h-full w-full">
      <MapContainer center={[alat, alng]} zoom={13} className="h-full w-full" scrollWheelZoom>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {/* Anchor: 500 Howard */}
        <CircleMarker
          center={[alat, alng]}
          radius={10}
          pathOptions={{ color: "#1f2937", weight: 3, fillColor: "#111827", fillOpacity: 0.9 }}
        >
          <Tooltip permanent direction="top" offset={[0, -8]}>
            ⚓ {settings.anchor_address.split(",")[0]}
          </Tooltip>
        </CircleMarker>

        {placed.map((l) => {
          const d = derive(l, settings);
          const c = scoreColor(d.score_combined);
          return (
            <CircleMarker
              key={l.id}
              center={[l.lat!, l.lng!]}
              radius={11}
              pathOptions={{ color: "#ffffff", weight: 2, fillColor: c.bg, fillOpacity: 0.95 }}
              eventHandlers={{ click: () => select(l.id) }}
            >
              <Tooltip direction="top">
                <div className="font-semibold">{l.name}</div>
                <div>
                  {money(l.rent)}/mo · score {d.score_combined?.toFixed(2) ?? "—"}
                </div>
              </Tooltip>
            </CircleMarker>
          );
        })}
      </MapContainer>

      {missing > 0 && (
        <div className="absolute bottom-3 left-3 z-[400] rounded-md bg-white/90 px-3 py-1.5 text-xs text-roost-muted shadow">
          {missing} listing{missing > 1 ? "s" : ""} without coordinates — add an address or run a commute
          lookup to geocode.
        </div>
      )}
    </div>
  );
}
