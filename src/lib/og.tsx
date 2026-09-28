import { ImageResponse } from "next/og";
import { PLAN, usd } from "@/lib/pricing";

// The social card every shared link shows: a title and a small receipt.
export const OG_SIZE = { width: 1200, height: 630 };

export function ogImage({ eyebrow, title }: { eyebrow: string; title: string }) {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: "#f6f4ef", color: "#14201b", padding: 72, gap: 56 }}>
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 30, fontWeight: 600 }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: "#17624b", display: "flex" }} />
            Flatdesk
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div style={{ fontSize: 24, letterSpacing: 3, textTransform: "uppercase", color: "#17624b" }}>{eyebrow}</div>
            <div style={{ fontSize: title.length > 60 ? 52 : 64, lineHeight: 1.08, fontWeight: 600 }}>{title}</div>
          </div>
          <div style={{ fontSize: 26, color: "#5b6660" }}>{`${usd(PLAN.seatPrice)} per agent · ${PLAN.includedPerAgent} AI resolutions included · capped`}</div>
        </div>
        <div
          style={{
            width: 330,
            display: "flex",
            flexDirection: "column",
            alignSelf: "center",
            background: "#fffdf9",
            border: "2px solid #e3ded3",
            padding: 32,
            gap: 14,
            fontSize: 22,
            transform: "rotate(2deg)",
          }}
        >
          <div style={{ fontSize: 18, letterSpacing: 2, color: "#5b6660", textTransform: "uppercase" }}>Monthly bill</div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span>10 × {usd(PLAN.seatPrice)}</span>
            <span>{usd(10 * PLAN.seatPrice)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", color: "#5b6660" }}>
            <span>{(10 * PLAN.includedPerAgent).toLocaleString("en-US")} AI answers</span>
            <span>included</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", borderTop: "2px dashed #cfc8b9", paddingTop: 14, fontWeight: 600, color: "#17624b" }}>
            <span>Every month</span>
            <span>{usd(10 * PLAN.seatPrice)}</span>
          </div>
          <div
            style={{
              alignSelf: "flex-end",
              marginTop: 6,
              border: "3px solid #17624b",
              color: "#17624b",
              padding: "4px 14px",
              fontSize: 22,
              letterSpacing: 4,
              transform: "rotate(-8deg)",
            }}
          >
            FLAT
          </div>
        </div>
      </div>
    ),
    OG_SIZE,
  );
}
