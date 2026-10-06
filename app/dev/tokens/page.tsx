import { notFound } from "next/navigation";

export const metadata = { title: "Tokens", robots: { index: false, follow: false } };

/** Dev-only design token reference (Phase 1 review artifact). */
export default function TokensPage() {
  if (process.env.NODE_ENV === "production") notFound();

  const colors: Array<[string, string, string?]> = [
    ["bg-base", "#000000"],
    ["bg-raised", "#101011"],
    ["surface-1", "#1c1c1e", "cartões"],
    ["surface-2", "#242426", "elevado, ativo"],
    ["surface-3", "#2c2c2e", "inputs"],
    ["text-primary", "#f5f5f7"],
    ["text-secondary", "#aeaeb2"],
    ["text-tertiary", "#8e8e93"],
    ["accent-500", "#e8112d", "ação, preenchimentos"],
    ["accent-400", "#ff453a", "acento em texto, preços"],
    ["accent-300", "#ff6961", "realce"],
    ["accent-700", "#b50e24", "premido"],
    ["ember-500", "#ff453a", "ao vivo, urgência"],
    ["ember-700", "#b50e24", "destrutivo"],
    ["amber-500", "#ff9f0a", "aviso"],
    ["green-500", "#30d158", "confirmado"],
  ];

  const scale = [12, 14, 16, 20, 24, 32, 40, 56, 80];

  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <h1
        className="mb-10 text-4xl font-bold text-text-primary"
        style={{ fontFamily: "var(--font-display)", letterSpacing: "-0.02em" }}
      >
        BetBeat · Tokens
      </h1>

      <h2 className="label mb-4 text-text-secondary">Cores</h2>
      <div className="mb-12 grid grid-cols-3 gap-3 md:grid-cols-5">
        {colors.map(([name, hex, use]) => (
          <div
            key={name}
            className="rounded-card border border-line-subtle bg-surface-1 p-3"
          >
            <div
              className="mb-2 h-14 rounded-chip border border-line-subtle"
              style={{ background: hex }}
            />
            <p className="text-sm font-semibold text-text-primary">{name}</p>
            <p className="tnum text-xs text-text-tertiary">{hex}</p>
            {use ? <p className="text-xs text-text-secondary">{use}</p> : null}
          </div>
        ))}
      </div>

      <h2 className="label mb-4 text-text-secondary">Efeitos</h2>
      <div className="mb-12 flex flex-wrap gap-6">
        <div className="rounded-card bg-surface-1 px-8 py-6 shadow-glow-accent text-accent-400">
          glow-accent
        </div>
        <div className="rounded-card bg-surface-1 px-8 py-6 shadow-glow-ember text-ember-500">
          glow-ember
        </div>
        <div
          className="flex items-center rounded-card px-8 py-6 font-semibold text-text-on-accent"
          style={{ background: "var(--gradient-heat)" }}
        >
          gradiente de calor
        </div>
        <div className="material rounded-card px-8 py-6 text-text-primary">
          material translúcido
        </div>
      </div>

      <h2 className="label mb-4 text-text-secondary">Escala tipográfica</h2>
      <div className="mb-12 flex flex-col gap-2">
        {scale.map((s) => (
          <p
            key={s}
            className="truncate text-text-primary"
            style={{
              fontSize: `${s / 16}rem`,
              lineHeight: s >= 24 ? 1.1 : 1.5,
              letterSpacing:
                s >= 40 ? "-0.02em" : s >= 24 ? "-0.01em" : s <= 12 ? "0.01em" : "0",
              fontFamily: s >= 32 ? "var(--font-display)" : "var(--font-ui)",
              fontWeight: s >= 32 ? 700 : 400,
            }}
          >
            {s}px — Pede a tua música
          </p>
        ))}
        <p
          className="mt-2 text-text-primary"
          style={{ fontFamily: "var(--font-editorial)", fontSize: "2rem" }}
        >
          <span className="tnum">24,50 €</span> · preço em corpo grande (mesma família, peso leve)
        </p>
      </div>

      <h2 className="label mb-4 text-text-secondary">Raios e grelha</h2>
      <div className="mb-12 flex flex-wrap items-end gap-4">
        {(
          [
            ["chip 8", "rounded-chip"],
            ["botão 12", "rounded-button"],
            ["cartão 16", "rounded-card"],
            ["folha 24", "rounded-sheet"],
            ["pílula", "rounded-full"],
          ] as const
        ).map(([label, cls]) => (
          <div
            key={label}
            className={`${cls} flex h-20 w-28 items-center justify-center border border-line-strong bg-surface-2 text-xs text-text-secondary`}
          >
            {label}
          </div>
        ))}
      </div>

      <h2 className="label mb-4 text-text-secondary">Motion</h2>
      <table className="tnum w-full max-w-xl text-left text-sm text-text-secondary">
        <tbody>
          {(
            [
              ["spring-default", "bounce 0 · 0.35s", "maioria das transições"],
              ["spring-move", "bounce 0 · 0.4s", "reposicionar"],
              ["spring-sheet", "bounce 0.2 · 0.3s", "folhas e gavetas"],
              ["spring-momentum", "bounce 0.2 · 0.4s", "após gesto com momento"],
              ["instant/fast/base/slow", "100/180/280/480 ms", "tweens de opacidade"],
              ["ambient", "1600 ms", "indicadores ao vivo"],
            ] as const
          ).map(([a, b, c]) => (
            <tr key={a} className="border-b border-line-subtle">
              <td className="py-2 pr-4 font-semibold text-text-primary">{a}</td>
              <td className="py-2 pr-4">{b}</td>
              <td className="py-2">{c}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-12 flex items-center gap-4">
        <div
          className="beat-pulse h-12 w-12 rounded-full bg-accent-500"
          style={{ ["--beat-period" as string]: "0.5s" }}
        />
        <p className="text-sm text-text-secondary">
          Beat Pulse — 120 BPM (estático com reduced motion)
        </p>
      </div>
    </main>
  );
}
