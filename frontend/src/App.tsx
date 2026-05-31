import { useEffect, useMemo, type ReactNode } from "react";

import { CardGallery } from "./components/CardGallery";
import { DetailDrawer } from "./components/DetailDrawer";
import { FilterRail } from "./components/FilterRail";
import { MapView } from "./components/MapView";
import { RankTable } from "./components/RankTable";
import { SettingsDialog } from "./components/SettingsDialog";
import { api } from "./api";
import { passes } from "./scoring";
import { STATIC } from "./static";
import { useStore, type ViewMode } from "./store";

export default function App() {
  const init = useStore((s) => s.init);
  const loading = useStore((s) => s.loading);
  const error = useStore((s) => s.error);
  const listings = useStore((s) => s.listings);
  const settings = useStore((s) => s.settings);
  const catMap = useStore((s) => s.catMap);
  const filter = useStore((s) => s.filter);
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const openSettings = useStore((s) => s.openSettings);

  useEffect(() => {
    init();
  }, [init]);

  const rows = useMemo(() => {
    if (!settings) return [];
    return listings.filter((l) => passes(l, settings, filter, catMap));
  }, [listings, settings, filter, catMap]);

  return (
    <div className="flex h-full flex-col">
      <TopBar
        view={view}
        setView={setView}
        count={rows.length}
        total={listings.length}
        onSettings={() => openSettings(true)}
      />

      {loading ? (
        <Center>Loading Roost…</Center>
      ) : error ? (
        <Center>
          <div className="text-rose-600">Couldn't reach the backend.</div>
          <div className="mt-1 text-sm text-roost-muted">{error}</div>
          <div className="mt-2 text-xs text-roost-muted">
            Start it with <code>uvicorn app.main:app --reload</code> in <code>backend/</code>.
          </div>
        </Center>
      ) : (
        <div className="flex min-h-0 flex-1">
          <FilterRail />
          <main className="min-w-0 flex-1">
            {view === "table" && <RankTable rows={rows} />}
            {view === "cards" && <CardGallery rows={rows} />}
            {view === "map" && <MapView rows={rows} />}
          </main>
        </div>
      )}

      <DetailDrawer />
      <SettingsDialog />
    </div>
  );
}

function TopBar({
  view,
  setView,
  count,
  total,
  onSettings,
}: {
  view: ViewMode;
  setView: (v: ViewMode) => void;
  count: number;
  total: number;
  onSettings: () => void;
}) {
  const views: { id: ViewMode; label: string }[] = [
    { id: "table", label: "Rank" },
    { id: "cards", label: "Cards" },
    { id: "map", label: "Map" },
  ];
  return (
    <header className="flex items-center justify-between border-b border-roost-line bg-roost-panel px-4 py-2.5">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xl">🪺</span>
          <h1 className="text-lg font-semibold tracking-tight">Roost</h1>
        </div>
        <span className="hidden text-xs text-roost-muted sm:inline">
          {count} of {total} listings · SF rental search
        </span>
      </div>

      <div className="inline-flex overflow-hidden rounded-md border border-roost-line text-sm">
        {views.map((v) => (
          <button
            key={v.id}
            className={`px-3 py-1.5 ${view === v.id ? "bg-roost-accent text-white" : "bg-white hover:bg-roost-bg"}`}
            onClick={() => setView(v.id)}
          >
            {v.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2">
        {!STATIC && <a className="btn hidden sm:inline-flex" href={api.exportCsvUrl()}>Export CSV</a>}
        <button className="btn" onClick={onSettings} title="Settings">⚙</button>
      </div>
    </header>
  );
}

function Center({ children }: { children: ReactNode }) {
  return <div className="flex flex-1 flex-col items-center justify-center text-center text-roost-muted">{children}</div>;
}
