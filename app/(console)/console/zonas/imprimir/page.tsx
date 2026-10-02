import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { query } from "@/lib/db";
import { env } from "@/lib/security/env";
import { signToken } from "@/lib/security/tokens";
import { QRBlock } from "@/components/ui/qr-block";
import { PageHeader } from "@/components/console/page-header";
import { PrintButton } from "@/components/console/print-button";
import { requireConsole } from "../../_lib/context";

export const dynamic = "force-dynamic";

/**
 * Print-ready zone QR cards (B9.2). Decision: @media print CSS +
 * window.print() instead of a PDF library — one A5 page per zone,
 * zero dependencies, and the browser's print dialog already exports PDF.
 */
export default async function PrintZonesPage() {
  const ctx = await requireConsole("/console/zonas/imprimir");
  const t = await getTranslations("console.zones");
  const venue = ctx.activeVenue;
  if (!venue) redirect("/console/zonas");

  const zones = (
    await query<{ id: string; name: string; qr_slug: string }>(
      `select id, name, qr_slug from public.zones where venue_id = $1 order by name asc`,
      [venue.id],
    )
  ).rows;

  return (
    <div>
      <style>{`
        @page { size: A5 portrait; margin: 0; }
        @media print {
          html, body { background: #ffffff !important; }
          main { padding: 0 !important; }
          .bb-qr-card {
            width: 148mm; height: 210mm;
            border: none !important; border-radius: 0 !important;
            break-after: page; page-break-after: always;
          }
        }
      `}</style>

      <div className="print:hidden">
        <PageHeader
          crumbs={[
            { label: t("crumbRoot") },
            { label: t("title"), href: "/console/zonas" },
            { label: t("print") },
          ]}
          title={t("printTitle")}
          actions={<PrintButton label={t("printNow")} />}
        />
        <p className="pb-6 text-sm text-text-tertiary">{t("printHint")}</p>
      </div>

      <div className="flex flex-col items-center gap-8 print:block print:gap-0">
        {zones.map((zone) => {
          const url = `${env.NEXT_PUBLIC_APP_URL}/s/${signToken({
            kind: "zone",
            venueId: venue.id,
            slug: zone.qr_slug,
          })}`;
          return (
            <section
              key={zone.id}
              data-testid="zone-print-card"
              data-zone-name={zone.name}
              className="bb-qr-card flex w-[148mm] flex-col items-center justify-center
                gap-8 rounded-card border border-line-subtle bg-white py-16 text-center"
            >
              <p
                className="label text-[#948a79]"
                style={{ letterSpacing: "0.08em" }}
              >
                {venue.name} · {zone.name}
              </p>
              <h2 className="font-display px-8 text-[2rem] font-extrabold leading-tight text-[#0a0806]">
                {t("printCta")}
              </h2>
              <QRBlock url={url} size={280} alt={t("qrAlt", { zone: zone.name })} />
              <p className="px-8 text-sm text-[#5c5547]">{t("printSub")}</p>
            </section>
          );
        })}
      </div>
    </div>
  );
}
