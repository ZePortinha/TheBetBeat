/**
 * Landing — the public face of BetBeat (server components).
 *
 * Design read: an Apple product page, dark. Centred hero with the record
 * as the product shot, highlight tiles with inline bold lead-ins, a bento
 * of the three sides and the guarantee as a brand-red tile. One family
 * (SF Pro / Inter), semibold headlines, size-specific tracking.
 * Skills: apple-design + design-taste-frontend. B10 wins on brand.
 */

import Link from "next/link";
import { getTranslations } from "next-intl/server";
import {
  ChevronRight,
  Headphones,
  QrCode,
  ShieldCheck,
  SlidersHorizontal,
  Store,
  Timer,
} from "lucide-react";
import { Disc } from "@/components/ui/disc";
import { Reveal } from "./reveal";

const wrap = "mx-auto w-full max-w-[1024px] px-5 md:px-8";
const headline =
  "font-display font-semibold leading-[1.05] tracking-[var(--tracking-display)] text-balance";
const subhead = "text-text-secondary";

const capsule =
  "inline-flex min-h-12 items-center rounded-full bg-accent-500 px-6 text-base " +
  "font-medium text-text-on-accent transition-[background-color,transform] duration-100 " +
  "hover:bg-accent-400 active:scale-[0.97] active:bg-accent-700";
const textLink =
  "inline-flex min-h-12 items-center gap-0.5 text-base font-medium text-accent-400 " +
  "transition-colors hover:text-accent-300 active:opacity-70";

/* ── Header (local nav: name left, links and one capsule right) ── */

export async function LandingHeader() {
  const t = await getTranslations("common.landing");
  const tc = await getTranslations("common");
  const link =
    "hidden text-[0.8125rem] text-text-secondary transition-colors " +
    "hover:text-text-primary md:inline";

  return (
    <header className="material-top sticky top-0 z-40">
      <div className={`${wrap} flex h-13 items-center justify-between`}>
        <Link
          href="/"
          className="text-xl font-semibold tracking-[var(--tracking-heading)]"
        >
          {tc("appName")}
        </Link>
        <nav className="flex items-center gap-7" aria-label={tc("appName")}>
          <a className={link} href="#como">
            {t("nav.how")}
          </a>
          <a className={link} href="#para-quem">
            {t("nav.sides")}
          </a>
          <a className={link} href="#garantia">
            {t("nav.guarantee")}
          </a>
          <Link className={link} href="/login">
            {t("nav.staff")}
          </Link>
          {/* Visible capsule is small; the link itself keeps a 44px target. */}
          <Link href="/entrar" className="group inline-flex min-h-11 items-center">
            <span className="rounded-full bg-accent-500 px-3.5 py-1 text-xs font-medium text-text-on-accent transition-[background-color,transform] duration-100 group-hover:bg-accent-400 group-active:scale-[0.97] group-active:bg-accent-700">
              {t("nav.party")}
            </span>
          </Link>
        </nav>
      </div>
    </header>
  );
}

/* ── Hero: centred copy, the record rising as the product shot ──── */

export async function Hero() {
  const t = await getTranslations("common.landing.hero");
  const tc = await getTranslations("common");

  return (
    <section className="relative isolate -mt-13 overflow-hidden pt-32 text-center md:pt-40">
      <div aria-hidden className="ambient-center absolute inset-x-0 bottom-0 -z-10 h-3/4" />

      <div className={wrap}>
        <Reveal>
          <p className="text-xl font-semibold tracking-[var(--tracking-heading)] text-accent-400 md:text-2xl">
            {tc("appName")}
          </p>
        </Reveal>
        <Reveal delay={0.04}>
          <h1 className={`${headline} mx-auto mt-3 max-w-[16ch] text-[clamp(2.75rem,7.5vw,5.5rem)]`}>
            {t("titleA")} <span className={subhead}>{t("titleB")}</span>
          </h1>
        </Reveal>
        <Reveal delay={0.08}>
          <p className="mx-auto mt-6 max-w-[38ch] text-lg leading-[1.45] text-text-secondary md:text-[1.3125rem]">
            {t("sub")}
          </p>
        </Reveal>
        <Reveal delay={0.12}>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-x-8 gap-y-2">
            <a href="#como" className={capsule}>
              {t("cta")}
            </a>
            <a href="#para-quem" className={textLink}>
              {t("ctaSecondary")}
              <ChevronRight size={18} strokeWidth={2} aria-hidden />
            </a>
          </div>
        </Reveal>
      </div>

      {/* Product shot: cropped by the section edge, fading into black. */}
      <Reveal delay={0.16} className="relative mx-auto mt-16 w-[min(86vw,38rem)] md:mt-20">
        <div aria-hidden className="relative aspect-square translate-y-[22%]">
          <svg
            viewBox="0 0 100 100"
            className="absolute -inset-[14%] size-[128%] text-accent-400"
            fill="none"
            stroke="currentColor"
            strokeWidth="0.16"
          >
            <circle cx="50" cy="50" r="49" opacity="0.08" />
            <circle cx="50" cy="50" r="44" opacity="0.16" />
          </svg>
          <span className="disc-ring inset-[3%] -rotate-12" />
          <Disc className="absolute inset-[6%] -rotate-12" />
        </div>
      </Reveal>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-linear-to-t from-bg-base to-transparent"
      />
    </section>
  );
}

/* ── How it works: three highlight tiles, bold lead-in sentences ── */

export async function How() {
  const t = await getTranslations("common.landing.how");
  const steps = [
    { Icon: QrCode, title: t("scan.title"), body: t("scan.body") },
    { Icon: Timer, title: t("choose.title"), body: t("choose.body") },
    { Icon: Headphones, title: t("decide.title"), body: t("decide.body") },
  ];

  return (
    <section id="como" className="scroll-mt-13 py-24 md:py-36">
      <div className={wrap}>
        <Reveal>
          <h2 className={`${headline} mx-auto max-w-[18ch] text-center text-[clamp(2.25rem,5.2vw,3.75rem)]`}>
            {t("title")} <span className={subhead}>{t("titleAccent")}</span>
          </h2>
        </Reveal>

        <ol className="mt-14 grid gap-4 md:mt-20 lg:grid-cols-3">
          {steps.map((s, i) => (
            <li key={s.title}>
              <Reveal
                delay={i * 0.06}
                className="h-full rounded-sheet bg-surface-1 p-8 md:p-9"
              >
                <s.Icon aria-hidden size={34} strokeWidth={1.5} className="text-accent-400" />
                <p className="mt-8 text-[1.1875rem] leading-[1.42] text-text-secondary">
                  <strong className="font-semibold text-text-primary">{s.title}</strong>{" "}
                  {s.body}
                </p>
              </Reveal>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* ── Three sides: one wide tile, two below (3 items = 3 cells) ──── */

export async function Sides() {
  const t = await getTranslations("common.landing.sides");
  const eyebrow = "text-lg font-semibold text-accent-400";
  const tileTitle =
    "font-display text-2xl font-semibold leading-[1.15] tracking-[var(--tracking-heading)] md:text-[1.75rem]";

  return (
    <section id="para-quem" className="scroll-mt-13 pb-24 md:pb-36">
      <div className={wrap}>
        <Reveal>
          <h2 className={`${headline} text-center text-[clamp(2.25rem,5.2vw,3.75rem)]`}>
            {t("title")} <span className={subhead}>{t("titleAccent")}</span>
          </h2>
        </Reveal>

        <div className="mt-14 grid gap-4 md:mt-20 md:grid-cols-2">
          {/* Guests: the wide tile, the record rising from its bottom edge. */}
          <Reveal className="relative isolate overflow-hidden rounded-sheet bg-surface-1 px-8 pt-12 text-center md:col-span-2 md:pt-16">
            <div aria-hidden className="ambient-center absolute inset-0 -z-10" />
            <p className={eyebrow}>{t("guest.label")}</p>
            <p className={`${headline} mt-3 text-[clamp(5rem,15vw,9.5rem)] leading-none`}>
              {t("guest.figure")}
            </p>
            <p className={`${tileTitle} mx-auto mt-4 max-w-[22ch]`}>{t("guest.title")}</p>
            <p className="mx-auto mt-4 max-w-[36ch] text-base leading-relaxed text-text-secondary md:text-lg">
              {t("guest.body")}
            </p>
            <div
              aria-hidden
              className="relative mx-auto mt-12 aspect-[10/7] w-[min(76%,24rem)] overflow-hidden"
            >
              <Disc initials="BB" className="absolute inset-x-0 top-0 w-full rotate-[18deg]" />
            </div>
          </Reveal>

          {[
            { key: "dj", Icon: SlidersHorizontal },
            { key: "venue", Icon: Store },
          ].map(({ key, Icon }, i) => (
            <Reveal
              key={key}
              delay={0.06 * (i + 1)}
              className="rounded-sheet bg-surface-1 p-8 md:p-10"
            >
              <Icon aria-hidden size={30} strokeWidth={1.5} className="text-accent-400" />
              <p className={`${eyebrow} mt-8`}>{t(`${key}.label`)}</p>
              <p className={`${tileTitle} mt-2`}>{t(`${key}.title`)}</p>
              <p className="mt-4 max-w-[34ch] text-base leading-relaxed text-text-secondary">
                {t(`${key}.body`)}
              </p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── Guarantee: one statement on a brand-red tile ───────────────── */

export async function Guarantee() {
  const t = await getTranslations("common.landing.guarantee");

  return (
    <section id="garantia" className="scroll-mt-13 pb-24 md:pb-36">
      <div className={wrap}>
        <Reveal className="rounded-sheet bg-accent-500 px-8 py-20 text-center text-text-on-accent md:py-28">
          <ShieldCheck aria-hidden size={44} strokeWidth={1.5} className="mx-auto" />
          <h2 className={`${headline} mx-auto mt-8 max-w-[16ch] text-[clamp(2.25rem,5.6vw,4rem)]`}>
            {t("title")}{" "}
            <span className="text-text-on-accent/80">{t("titleAccent")}</span>
          </h2>
          <p className="mx-auto mt-6 max-w-[42ch] text-lg font-medium leading-relaxed">
            {t("body")}
          </p>
        </Reveal>
      </div>
    </section>
  );
}

/* ── Footer: small print, hairline dividers ─────────────────────── */

export async function Footer() {
  const t = await getTranslations("common.landing");
  const tc = await getTranslations("common");
  const link =
    "inline-flex min-h-11 items-center text-text-secondary transition-colors hover:text-text-primary";

  return (
    <footer className="border-t border-line-subtle pb-10 pt-8 text-[0.8125rem] text-text-tertiary">
      <div className={`${wrap} flex flex-col gap-4 md:flex-row md:items-center md:justify-between`}>
        <div>
          <p className="text-base font-semibold text-text-primary">{tc("appName")}</p>
          <p className="mt-1">{tc("tagline")}</p>
        </div>
        <nav className="flex flex-wrap gap-x-6" aria-label={tc("appName")}>
          <a className={link} href="#como">
            {t("nav.how")}
          </a>
          <a className={link} href="#para-quem">
            {t("nav.sides")}
          </a>
          <a className={link} href="#garantia">
            {t("nav.guarantee")}
          </a>
          <Link className={link} href="/entrar">
            {t("nav.party")}
          </Link>
          <Link className={link} href="/login">
            {t("nav.staff")}
          </Link>
        </nav>
      </div>
      <div className={wrap}>
        <p className="mt-6 border-t border-line-subtle pt-6">{t("footer.rights")}</p>
      </div>
    </footer>
  );
}

/* ── Dev entry points (never rendered in production) ────────────── */

export async function DevStrip({
  guestHref,
  displayHref,
}: {
  guestHref: string | null;
  displayHref: string | null;
}) {
  const t = await getTranslations("common.devIndex");
  const chip =
    "inline-flex min-h-10 items-center rounded-full border border-line-strong " +
    "px-4 text-sm font-medium text-text-primary transition-colors hover:bg-surface-2";

  return (
    <aside className="border-t border-line-subtle py-6">
      <div className={`${wrap} flex flex-wrap items-center gap-3`}>
        <p className="label mr-2 text-text-tertiary">{t("title")}</p>
        {guestHref ? (
          <Link className={chip} href={guestHref} data-testid="dev-guest-link">
            {t("guest")}
          </Link>
        ) : null}
        <Link className={chip} href="/cockpit">
          {t("cockpit")}
        </Link>
        {displayHref ? (
          <Link className={chip} href={displayHref}>
            {t("display")}
          </Link>
        ) : null}
        <Link className={chip} href="/console">
          {t("console")}
        </Link>
      </div>
    </aside>
  );
}
