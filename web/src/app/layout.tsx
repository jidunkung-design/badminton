import type { Metadata } from "next";
import { Mitr, Anuphan } from "next/font/google";
import "./globals.css";

// Self-hosted at build time (no CDN, no CSP hole, no layout shift).
// Mitr: display face, rounded terminals -- reads like a hand-painted
// gym sign, warm without being childish. Anuphan: body/UI face, a
// quiet humanist that holds up at the 13-15px Thai sizes this app
// actually lives at. Deliberately not Kanit/Prompt/Sarabun/IBM Plex
// Sans Thai -- the Thai design monoculture the brief asked to avoid.
const mitr = Mitr({
  subsets: ["thai", "latin"],
  weight: ["500", "600", "700"],
  variable: "--font-mitr",
  display: "swap",
});

const anuphan = Anuphan({
  subsets: ["thai", "latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-anuphan",
  display: "swap",
});

export const metadata: Metadata = {
  title: "ก๊วนแบด",
  description: "จัดก๊วนแบด เช็กชื่อ จัดคิว หารค่าสนาม",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="th" className={`${mitr.variable} ${anuphan.variable}`}>
      <body>
        <header className="bar">ก๊วนแบด</header>
        <div className="wrap pane">{children}</div>
      </body>
    </html>
  );
}
