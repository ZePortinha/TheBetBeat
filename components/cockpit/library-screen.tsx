"use client";

/**
 * Biblioteca (2026-10-11): the DJ builds and browses their own library by
 * artist, album and style. Songs are added by hand or from the catalog (one
 * song or a whole album); a tap on an artist, album or style narrows the
 * song list to it. Edits and removals in a bottom sheet.
 */

import * as React from "react";
import { useTranslations } from "next-intl";
import { Check, Disc3, Library, Plus, Search, X } from "lucide-react";
import { EVENT_STYLES } from "@/lib/catalog/styles";
import type { LibraryGroupDto, LibraryTrackDto, LibraryView } from "@/lib/catalog/library";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { cx, Pressable } from "@/components/ui/pressable";
import { useToast } from "@/components/ui/toast";

type Filter = { kind: "artist" | "album" | "genre"; name: string } | null;
type Summary = { tracks: number; artists: number; albums: number; styles: number };

const inputCls =
  "min-h-14 w-full min-w-0 rounded-button border border-line-subtle bg-surface-2 px-4 text-lg text-text-primary " +
  "placeholder:text-text-tertiary focus:border-accent-500 focus:outline-none focus:ring-4 focus:ring-accent-500/25";

function TempoChip({ bpm, camelotKey }: { bpm: number | null; camelotKey: string | null }) {
  const t = useTranslations("cockpit.library");
  if (bpm === null && !camelotKey) return null;
  return (
    <span className="tnum shrink-0 rounded-full border border-line-strong bg-surface-2 px-2 py-0.5 text-sm font-semibold text-text-primary">
      {bpm !== null ? t("bpm", { bpm: Math.round(bpm) }) : null}
      {bpm !== null && camelotKey ? " · " : null}
      {camelotKey}
    </span>
  );
}

export function LibraryScreen({ venueId, venueName }: { venueId: string | null; venueName: string | null }) {
  const t = useTranslations("cockpit.library");
  const { toast } = useToast();
  const [view, setView] = React.useState<LibraryView>("tracks");
  const [query, setQuery] = React.useState("");
  const [filter, setFilter] = React.useState<Filter>(null);
  const [summary, setSummary] = React.useState<Summary | null>(null);
  const [tracks, setTracks] = React.useState<LibraryTrackDto[] | null>(null);
  const [groups, setGroups] = React.useState<LibraryGroupDto[] | null>(null);
  const [editing, setEditing] = React.useState<LibraryTrackDto | "new" | null>(null);
  const [catalogOpen, setCatalogOpen] = React.useState(false);

  const load = React.useCallback(async () => {
    if (!venueId) return;
    const params = new URLSearchParams({ venueId, view });
    if (query.trim()) params.set("q", query.trim());
    if (filter) params.set(filter.kind, filter.name);
    const res = await fetch(`/api/cockpit/library?${params}`, { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as { summary: Summary; tracks?: LibraryTrackDto[]; groups?: LibraryGroupDto[] };
    setSummary(data.summary);
    setTracks(data.tracks ?? null);
    setGroups(data.groups ?? null);
  }, [venueId, view, query, filter]);

  React.useEffect(() => {
    const id = setTimeout(() => void load(), query ? 200 : 0);
    return () => clearTimeout(id);
  }, [load, query]);

  if (!venueId) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <EmptyState icon={Library} title={t("title")} hint={t("noVenue")} />
      </div>
    );
  }

  const openGroup = (g: LibraryGroupDto) => {
    setFilter({ kind: view === "artists" ? "artist" : view === "albums" ? "album" : "genre", name: g.name });
    setView("tracks");
  };

  const empty = summary?.tracks === 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-6" data-testid="library-screen">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-3xl font-bold tracking-tight text-text-primary" style={{ fontFamily: "var(--font-display)" }}>
            {t("title")}
            {venueName ? <span className="ml-2 text-lg font-semibold text-text-tertiary">{venueName}</span> : null}
          </h1>
          <p className="mt-1 text-sm text-text-secondary">{t("subtitle")}</p>
          {summary ? (
            <p className="tnum mt-1 text-sm font-semibold text-text-secondary" data-testid="library-summary">
              {t("summary", summary)}
            </p>
          ) : null}
        </div>
        <div className="flex gap-2">
          <Button size="lg" variant="secondary" onPress={() => setCatalogOpen(true)}>
            <Disc3 size={18} aria-hidden />
            {t("fromCatalog")}
          </Button>
          <Button size="lg" onPress={() => setEditing("new")}>
            <Plus size={18} aria-hidden />
            {t("add")}
          </Button>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <div role="radiogroup" aria-label={t("viewsLabel")} className="flex gap-1 rounded-button border border-line-subtle bg-surface-2 p-1">
          {(["tracks", "artists", "albums", "styles"] as const).map((v) => (
            <Pressable
              key={v}
              role="radio"
              aria-checked={view === v}
              onPress={() => {
                setView(v);
                if (v !== "tracks") setFilter(null);
              }}
              className={cx(
                "flex min-h-12 items-center gap-1.5 rounded-button px-4 text-base font-semibold transition-colors duration-100",
                view === v ? "bg-accent-500 text-text-on-accent" : "text-text-secondary data-pressed:bg-surface-3",
              )}
            >
              {view === v ? <Check size={16} aria-hidden /> : null}
              {t(`views.${v}`)}
            </Pressable>
          ))}
        </div>
        <label className="relative min-w-60 flex-1">
          <Search size={18} aria-hidden className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-text-tertiary" />
          <span className="sr-only">{t("search")}</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("search")}
            className={cx(inputCls, "pl-11")}
          />
        </label>
      </div>

      {filter ? (
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-accent-500/15 px-3 py-1.5 text-sm font-semibold text-accent-400" data-testid="library-filter">
            {t(filter.kind === "artist" ? "filterArtist" : filter.kind === "album" ? "filterAlbum" : "filterGenre", { name: filter.name })}
          </span>
          <Button variant="ghost" onPress={() => setFilter(null)}>
            <X size={16} aria-hidden />
            {t("clearFilter")}
          </Button>
        </div>
      ) : null}

      {empty ? (
        <EmptyState icon={Library} title={t("emptyTitle")} hint={t("emptyHint")} />
      ) : view === "tracks" ? (
        tracks && tracks.length === 0 ? (
          <p className="text-sm text-text-tertiary">{t("noResults")}</p>
        ) : (
          <ul className="flex flex-col gap-2" data-testid="library-tracks">
            {(tracks ?? []).map((tr) => (
              <li key={tr.id}>
                <Pressable
                  onPress={() => setEditing(tr)}
                  className="flex min-h-14 w-full items-center gap-3 rounded-card border border-line-subtle bg-surface-1 px-4 py-2 text-left data-pressed:bg-surface-2"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-base font-semibold text-text-primary">{tr.title}</span>
                    <span className="block truncate text-sm text-text-secondary">
                      {[tr.artist, tr.album, tr.year].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <span className="shrink-0 rounded-full bg-surface-3 px-2 py-0.5 text-xs font-semibold text-text-secondary">{tr.genre}</span>
                  {tr.blocked ? <span className="shrink-0 text-xs font-semibold text-ember-500">{t("blocked")}</span> : null}
                  <TempoChip bpm={tr.bpm} camelotKey={tr.camelotKey} />
                </Pressable>
              </li>
            ))}
          </ul>
        )
      ) : groups && groups.length === 0 ? (
        <p className="text-sm text-text-tertiary">{t("noResults")}</p>
      ) : (
        <ul className="grid grid-cols-2 gap-2 xl:grid-cols-3" data-testid="library-groups">
          {(groups ?? []).map((g) => (
            <li key={`${g.name}::${g.artist ?? ""}`}>
              <Pressable
                onPress={() => openGroup(g)}
                className="flex min-h-14 w-full flex-col items-start justify-center rounded-card border border-line-subtle bg-surface-1 px-4 py-3 text-left data-pressed:bg-surface-2"
              >
                <span className="block w-full truncate text-base font-semibold text-text-primary">
                  {g.name}
                  {g.year ? <span className="ml-1 font-normal text-text-tertiary">({g.year})</span> : null}
                </span>
                <span className="tnum block w-full truncate text-sm text-text-secondary">
                  {view === "artists"
                    ? t("artistLine", { tracks: g.tracks, albums: g.secondary })
                    : view === "albums"
                      ? t("albumLine", { artist: g.artist ?? "", tracks: g.tracks })
                      : t("styleLine", { tracks: g.tracks, artists: g.secondary })}
                  {g.blocked ? ` · ${t("styleBlocked")}` : ""}
                </span>
              </Pressable>
            </li>
          ))}
        </ul>
      )}

      <TrackSheet
        venueId={venueId}
        track={editing}
        onClose={() => setEditing(null)}
        onSaved={(msg) => {
          toast({ title: msg, variant: "success" });
          setEditing(null);
          void load();
        }}
        onError={(msg) => toast({ title: msg, variant: "error" })}
      />
      <CatalogSheet
        venueId={venueId}
        open={catalogOpen}
        onClose={() => setCatalogOpen(false)}
        onAdded={(msg) => {
          toast({ title: msg, variant: "success" });
          void load();
        }}
        onError={(msg) => toast({ title: msg, variant: "error" })}
      />
    </div>
  );
}

/** A labelled field for the sheets. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className="label text-text-secondary">{label}</span>
      {children}
    </label>
  );
}

function StyleOptions({ id }: { id: string }) {
  return (
    <datalist id={id}>
      {EVENT_STYLES.map((s) => (
        <option key={s} value={s} />
      ))}
    </datalist>
  );
}

function TrackSheet({
  venueId,
  track,
  onClose,
  onSaved,
  onError,
}: {
  venueId: string;
  track: LibraryTrackDto | "new" | null;
  onClose: () => void;
  onSaved: (message: string) => void;
  onError: (message: string) => void;
}) {
  const t = useTranslations("cockpit.library");
  const existing = track && track !== "new" ? track : null;
  const [form, setForm] = React.useState({ title: "", artist: "", album: "", genre: "", bpm: "", key: "", year: "" });
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<"save" | "remove" | null>(null);

  React.useEffect(() => {
    if (!track) return;
    setError(null);
    setForm(
      existing
        ? {
            title: existing.title,
            artist: existing.artist,
            album: existing.album ?? "",
            genre: existing.genre,
            bpm: existing.bpm === null ? "" : String(existing.bpm),
            key: existing.camelotKey ?? "",
            year: existing.year === null ? "" : String(existing.year),
          }
        : { title: "", artist: "", album: "", genre: "", bpm: "", key: "", year: "" },
    );
  }, [track, existing]);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async () => {
    if (!form.title.trim() || !form.artist.trim() || !form.genre.trim()) return setError(t("form.required"));
    const bpm = form.bpm.trim() ? Number(form.bpm.replace(",", ".")) : null;
    if (bpm !== null && !(bpm >= 40 && bpm <= 250)) return setError(t("form.invalidBpm"));
    const year = form.year.trim() ? Number(form.year) : null;
    if (year !== null && !(Number.isInteger(year) && year >= 1900 && year <= 2100)) return setError(t("form.invalidYear"));
    setError(null);
    setBusy("save");
    const body = {
      venueId,
      title: form.title.trim(),
      artist: form.artist.trim(),
      album: form.album.trim() || null,
      genre: form.genre.trim(),
      bpm,
      camelotKey: form.key.trim() || null,
      year,
    };
    const res = await fetch(existing ? `/api/cockpit/library/${existing.id}` : "/api/cockpit/library", {
      method: existing ? "PATCH" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(null);
    if (res.status === 409) return setError(t("toast.duplicate"));
    if (!res.ok) return onError(t("toast.error"));
    onSaved(existing ? t("toast.saved") : t("toast.added"));
  };

  const remove = async () => {
    if (!existing) return;
    setBusy("remove");
    const res = await fetch(`/api/cockpit/library/${existing.id}?venueId=${venueId}`, { method: "DELETE" });
    setBusy(null);
    if (!res.ok) return onError(t("toast.error"));
    const data = (await res.json()) as { outcome: "deleted" | "blocked" };
    onSaved(data.outcome === "blocked" ? t("toast.blocked") : t("toast.deleted"));
  };

  return (
    <BottomSheet
      open={track !== null}
      onOpenChange={(open) => (!open ? onClose() : undefined)}
      title={existing ? t("form.editTitle") : t("form.addTitle")}
    >
      <form
        className="flex flex-col gap-4 pb-4"
        data-testid="library-track-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("form.title")}>
            <input name="title" value={form.title} onChange={set("title")} maxLength={160} className={inputCls} />
          </Field>
          <Field label={t("form.artist")}>
            <input name="artist" value={form.artist} onChange={set("artist")} maxLength={160} className={inputCls} />
          </Field>
          <Field label={t("form.album")}>
            <input name="album" value={form.album} onChange={set("album")} maxLength={120} className={inputCls} />
          </Field>
          <Field label={t("form.genre")}>
            <input name="genre" value={form.genre} onChange={set("genre")} maxLength={64} list="library-styles" className={inputCls} />
            <StyleOptions id="library-styles" />
          </Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label={t("form.bpm")}>
            <input name="bpm" inputMode="decimal" value={form.bpm} onChange={set("bpm")} className={cx(inputCls, "tnum")} />
          </Field>
          <Field label={t("form.key")}>
            <input name="key" value={form.key} onChange={set("key")} maxLength={4} className={cx(inputCls, "tnum")} />
          </Field>
          <Field label={t("form.year")}>
            <input name="year" inputMode="numeric" value={form.year} onChange={set("year")} maxLength={4} className={cx(inputCls, "tnum")} />
          </Field>
        </div>
        {error ? (
          <p role="alert" className="text-sm text-ember-500">
            {error}
          </p>
        ) : null}
        <Button size="lg" type="submit" fullWidth loading={busy === "save"}>
          {busy === "save" ? t("form.saving") : t("form.save")}
        </Button>
        {existing ? (
          <Button size="lg" variant="destructiveGhost" fullWidth loading={busy === "remove"} onPress={() => void remove()}>
            {t("form.remove")}
          </Button>
        ) : null}
      </form>
    </BottomSheet>
  );
}

type CatalogTrackHit = { id: string; title: string; artist: string; genre: string | null; bpm: number | null; coverUrl: string | null };
type CatalogAlbumHit = { providerAlbumId: string; title: string; artist: string; coverUrl: string | null; trackCount: number | null };

function CatalogSheet({
  venueId,
  open,
  onClose,
  onAdded,
  onError,
}: {
  venueId: string;
  open: boolean;
  onClose: () => void;
  onAdded: (message: string) => void;
  onError: (message: string) => void;
}) {
  const t = useTranslations("cockpit.library");
  const [q, setQ] = React.useState("");
  const [genre, setGenre] = React.useState("");
  const [results, setResults] = React.useState<{ tracks: CatalogTrackHit[]; albums: CatalogAlbumHit[] } | null>(null);
  const [picked, setPicked] = React.useState<Set<string>>(new Set());
  const [busy, setBusy] = React.useState<string | null>(null);
  const [hint, setHint] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open || q.trim().length < 2) return;
    const id = setTimeout(async () => {
      const res = await fetch(`/api/cockpit/library/catalog?${new URLSearchParams({ venueId, q: q.trim() })}`, { cache: "no-store" });
      if (!res.ok) return setHint(t("catalog.unavailable"));
      setHint(null);
      setResults((await res.json()) as { tracks: CatalogTrackHit[]; albums: CatalogAlbumHit[] });
    }, 250);
    return () => clearTimeout(id);
  }, [q, open, venueId, t]);

  const add = async (body: { trackIds: string[] } | { albumId: string }, key: string) => {
    if (!genre.trim()) return setHint(t("catalog.needGenre"));
    setBusy(key);
    const res = await fetch("/api/cockpit/library/catalog", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ venueId, genre: genre.trim(), ...body }),
    });
    setBusy(null);
    if (!res.ok) return onError(t("toast.error"));
    const data = (await res.json()) as { added: number };
    setPicked(new Set());
    onAdded(t("toast.catalogAdded", { added: data.added }));
  };

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <BottomSheet open={open} onOpenChange={(o) => (!o ? onClose() : undefined)} title={t("catalog.title")} description={t("catalog.hint")}>
      <div className="flex flex-col gap-4 pb-4" data-testid="library-catalog">
        <div className="grid grid-cols-[2fr_1fr] gap-3">
          <Field label={t("catalog.search")}>
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} className={inputCls} />
          </Field>
          <Field label={t("catalog.genre")}>
            <input value={genre} onChange={(e) => setGenre(e.target.value)} list="catalog-styles" maxLength={64} className={inputCls} />
            <StyleOptions id="catalog-styles" />
          </Field>
        </div>
        {hint ? (
          <p role="alert" className="text-sm text-amber-500">
            {hint}
          </p>
        ) : null}
        {results && results.tracks.length === 0 && results.albums.length === 0 ? (
          <p className="text-sm text-text-tertiary">{t("catalog.nothing")}</p>
        ) : null}
        {results && results.albums.length > 0 ? (
          <section className="flex flex-col gap-2">
            <h3 className="label text-text-tertiary">{t("catalog.albums")}</h3>
            {results.albums.map((a) => (
              <div key={a.providerAlbumId} className="flex items-center gap-3 rounded-card bg-surface-1 px-4 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold text-text-primary">{a.title}</span>
                  <span className="block truncate text-sm text-text-secondary">{a.artist}</span>
                </span>
                <Button variant="secondary" loading={busy === a.providerAlbumId} onPress={() => void add({ albumId: a.providerAlbumId }, a.providerAlbumId)}>
                  {t("catalog.addAlbum")}
                </Button>
              </div>
            ))}
          </section>
        ) : null}
        {results && results.tracks.length > 0 ? (
          <section className="flex flex-col gap-2">
            <h3 className="label text-text-tertiary">{t("catalog.songs")}</h3>
            {results.tracks.map((tr) => {
              const on = picked.has(tr.id);
              return (
                <Pressable
                  key={tr.id}
                  role="checkbox"
                  aria-checked={on}
                  onPress={() => toggle(tr.id)}
                  className={cx(
                    "flex min-h-14 w-full items-center gap-3 rounded-card border px-4 py-2 text-left",
                    on ? "border-accent-500 bg-surface-2" : "border-line-subtle bg-surface-1 data-pressed:bg-surface-2",
                  )}
                >
                  <span className={cx("flex size-6 shrink-0 items-center justify-center rounded-full border", on ? "border-accent-500 bg-accent-500 text-text-on-accent" : "border-line-strong")}>
                    {on ? <Check size={14} aria-hidden /> : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold text-text-primary">{tr.title}</span>
                    <span className="block truncate text-sm text-text-secondary">{tr.artist}</span>
                  </span>
                  <TempoChip bpm={tr.bpm} camelotKey={null} />
                </Pressable>
              );
            })}
            <Button size="lg" fullWidth disabled={picked.size === 0} loading={busy === "tracks"} onPress={() => void add({ trackIds: [...picked] }, "tracks")}>
              {t("catalog.addSelected", { count: picked.size })}
            </Button>
          </section>
        ) : null}
      </div>
    </BottomSheet>
  );
}
