import { useMemo, useState } from "react";
import L from "leaflet";
import { CircleMarker, MapContainer, Marker, TileLayer, Tooltip, useMap, useMapEvents } from "react-leaflet";

import { scoreColor } from "../lib/colors";
import { money } from "../lib/format";
import { derive } from "../scoring";
import { useStore } from "../store";
import type { Listing } from "../types";

// Score-colored markers + a pinned anchor at 500 Howard. CircleMarker avoids the
// classic Leaflet "missing default marker icon" bundler headache entirely.
//
// With ~1,200 placed listings, rendering every pin chokes Leaflet, so we cluster
// client-side: pins are bucketed into a pixel-space grid at the current zoom.
// Buckets with a single pin render as the usual interactive CircleMarker; buckets
// with several collapse into a count badge that zooms into its members on click.
// No extra dependency — just react-leaflet's map events + a divIcon badge.

// Pixel size of each grid cell. Larger => more aggressive grouping.
const CELL_PX = 60;

interface Cluster {
  key: string;
  lat: number;
  lng: number;
  members: Listing[];
}

// Bucket placed listings into a screen-space grid for the given map state. Cell
// keys are derived from each pin's projected pixel coordinate at the current
// zoom, so clusters tighten/loosen naturally as the user zooms.
function clusterPins(map: L.Map, placed: Listing[]): Cluster[] {
  const zoom = map.getZoom();
  const buckets = new Map<string, Listing[]>();

  for (const l of placed) {
    const pt = map.project([l.lat!, l.lng!], zoom);
    const key = `${Math.floor(pt.x / CELL_PX)}:${Math.floor(pt.y / CELL_PX)}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(l);
    else buckets.set(key, [l]);
  }

  const clusters: Cluster[] = [];
  for (const [key, members] of buckets) {
    // Average member coords so the badge sits over the visual centroid.
    let sumLat = 0;
    let sumLng = 0;
    for (const m of members) {
      sumLat += m.lat!;
      sumLng += m.lng!;
    }
    clusters.push({ key, lat: sumLat / members.length, lng: sumLng / members.length, members });
  }
  return clusters;
}

function clusterIcon(count: number): L.DivIcon {
  // Scale the badge a bit with magnitude so dense areas read as heavier.
  const size = count < 10 ? 34 : count < 100 ? 40 : 46;
  return L.divIcon({
    html: `<div class="roost-cluster">${count}</div>`,
    className: "roost-cluster-wrap",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function ClusterLayer({ rows }: { rows: Listing[] }) {
  const settings = useStore((s) => s.settings)!;
  const select = useStore((s) => s.select);
  const map = useMap();

  const placed = useMemo(() => rows.filter((l) => l.lat != null && l.lng != null), [rows]);

  // Recompute clusters whenever the view changes. A version counter bumped on
  // map events is enough to re-derive from the live map projection.
  const [version, setVersion] = useState(0);
  useMapEvents({
    moveend: () => setVersion((v) => v + 1),
    zoomend: () => setVersion((v) => v + 1),
  });

  const clusters = useMemo(() => clusterPins(map, placed), [map, placed, version]);

  return (
    <>
      {clusters.map((cluster) => {
        if (cluster.members.length === 1) {
          const l = cluster.members[0];
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
        }

        return (
          <Marker
            key={cluster.key}
            position={[cluster.lat, cluster.lng]}
            icon={clusterIcon(cluster.members.length)}
            eventHandlers={{
              click: () => {
                // Zoom to fit the cluster's members so it expands toward
                // individual pins; fall back to a step-in when they share a point.
                const bounds = L.latLngBounds(
                  cluster.members.map((m) => [m.lat!, m.lng!] as [number, number]),
                );
                if (bounds.getNorthEast().equals(bounds.getSouthWest())) {
                  map.setView([cluster.lat, cluster.lng], Math.min(map.getZoom() + 2, 18));
                } else {
                  map.fitBounds(bounds, { padding: [40, 40], maxZoom: 18 });
                }
              },
            }}
          >
            <Tooltip direction="top">{cluster.members.length} listings — click to zoom in</Tooltip>
          </Marker>
        );
      })}
    </>
  );
}

export function MapView({ rows }: { rows: Listing[] }) {
  const settings = useStore((s) => s.settings)!;
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

        <ClusterLayer rows={rows} />
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
