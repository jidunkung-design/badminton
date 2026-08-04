import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ก๊วนแบด",
  description: "ระบบจัดการสโมสรแบดมินตัน",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="th">
      <body>
        <header className="bar">ก๊วนแบด</header>
        <div className="wrap pane">{children}</div>
      </body>
    </html>
  );
}
