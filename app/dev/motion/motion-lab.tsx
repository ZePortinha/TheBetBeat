"use client";

import * as React from "react";
import { BootIntro } from "@/components/ui/boot-intro";
import { FinalStretchFrame } from "@/components/ui/final-stretch-frame";
import { GavelStrike } from "@/components/ui/gavel-strike";
import { TickingCountdown } from "@/components/ui/ticking-countdown";
import { WinCelebration } from "@/components/guest/win-celebration";
import { countdown } from "@/components/guest/use-auction";

/** Replays each moment on demand; ?scene=final|win|intro starts one at once (screenshots). */
export function MotionLab() {
  const [introKey, setIntroKey] = React.useState(0);
  const [showIntro, setShowIntro] = React.useState(false);
  const [win, setWin] = React.useState(false);
  const [closesAt, setClosesAt] = React.useState<number | null>(null);
  const [now, setNow] = React.useState(() => Date.now());

  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, []);

  React.useEffect(() => {
    const scene = new URLSearchParams(window.location.search).get("scene");
    const start = Number(new URLSearchParams(window.location.search).get("from") ?? "33");
    if (scene === "final") setClosesAt(Date.now() + start * 1000);
    if (scene === "win") setWin(true);
    if (scene === "intro") replayIntro();
  }, []);

  function replayIntro() {
    try {
      sessionStorage.removeItem("bb-intro");
    } catch {}
    delete document.documentElement.dataset.intro;
    setShowIntro(true);
    setIntroKey((k) => k + 1);
  }

  const left = closesAt === null ? null : closesAt - now;
  const seconds = left === null ? null : Math.max(0, Math.ceil(left / 1000));
  const final = seconds !== null && seconds > 0 && seconds <= 30;
  const iso = closesAt === null ? null : new Date(closesAt).toISOString();

  return (
    <main className="guest-type mx-auto flex min-h-dvh max-w-md flex-col gap-6 px-4 py-8">
      <h1 className="text-2xl font-bold">Motion lab</h1>
      <div className="flex flex-wrap gap-2">
        <button className="rounded-full bg-surface-2 px-4 py-2" onClick={replayIntro}>
          Intro
        </button>
        <button className="rounded-full bg-surface-2 px-4 py-2" onClick={() => setClosesAt(Date.now() + 33_000)}>
          Últimos 30 s
        </button>
        <button className="rounded-full bg-surface-2 px-4 py-2" onClick={() => setClosesAt(Date.now() + 12_000)}>
          Últimos 10 s
        </button>
        <button className="rounded-full bg-surface-2 px-4 py-2" onClick={() => setWin(true)}>
          Vencedor
        </button>
      </div>

      {iso ? (
        <article
          className={[
            "rounded-sheet border border-accent-500/40 bg-surface-1 p-5 shadow-glow-accent",
            final ? "auction-flash-card" : "",
          ].join(" ")}
        >
          <p className="label text-accent-400">Leilão aberto</p>
          <p className="mt-3 flex items-center gap-3 text-5xl font-bold">
            <TickingCountdown
              value={countdown(iso, now)}
              beat={final}
              className={final ? "auction-flash-text" : "text-text-primary"}
            />
            {seconds === 0 ? <GavelStrike buzz className="text-accent-400" /> : null}
          </p>
        </article>
      ) : null}

      {final && seconds !== null ? <FinalStretchFrame secondsLeft={seconds} /> : null}
      {showIntro ? <BootIntro key={introKey} /> : null}
      {win ? (
        <WinCelebration
          slotId="00000000-0000-4000-8000-000000000000"
          trackTitle="Velvet Drift"
          trackArtist="Linha Oito"
          totalCents={4200}
          coverUrl={null}
          onClose={() => setWin(false)}
        />
      ) : null}
    </main>
  );
}
