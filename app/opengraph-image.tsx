import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import common from "@/messages/pt-PT/common.json";

/** Share card for every public link (1200×630): the mark, the promise, the guarantee. */
export const alt = common.meta.ogAlt;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const RED = "#e8112d";

export default async function OpengraphImage() {
  const [bold, medium] = await Promise.all([
    readFile(join(process.cwd(), "assets/fonts/InterDisplay-Bold.otf")),
    readFile(join(process.cwd(), "assets/fonts/Inter-Medium.otf")),
  ]);
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          padding: "0 88px",
          gap: 72,
          background: "radial-gradient(circle at 78% 50%, #3a0510 0%, #000000 62%)",
          color: "#f5f5f7",
          fontFamily: "Inter",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
          <div style={{ fontSize: 40, fontWeight: 700, color: "#ff453a" }}>{common.appName}</div>
          <div
            style={{
              marginTop: 20,
              fontSize: 84,
              fontWeight: 700,
              lineHeight: 1.04,
              letterSpacing: "-0.022em",
            }}
          >
            {common.landing.hero.titleA}
          </div>
          <div
            style={{ fontSize: 84, fontWeight: 700, lineHeight: 1.04, letterSpacing: "-0.022em", color: "#aeaeb2" }}
          >
            {common.landing.hero.titleB}
          </div>
          <div style={{ marginTop: 36, fontSize: 32, fontWeight: 500, color: "#aeaeb2", lineHeight: 1.35 }}>
            {`${common.landing.guarantee.title} ${common.landing.guarantee.titleAccent}`}
          </div>
        </div>
        <svg width="360" height="360" viewBox="0 0 512 512">
          <circle cx="256" cy="256" r="150" fill="none" stroke={RED} strokeWidth="22" opacity="0.35" />
          <circle cx="256" cy="256" r="104" fill="none" stroke={RED} strokeWidth="24" opacity="0.7" />
          <circle cx="256" cy="256" r="58" fill={RED} />
          <circle cx="256" cy="256" r="20" fill="#000000" />
        </svg>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Inter", data: bold, weight: 700, style: "normal" },
        { name: "Inter", data: medium, weight: 500, style: "normal" },
      ],
    },
  );
}
