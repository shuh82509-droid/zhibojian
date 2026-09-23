import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";
import { requireLiveRoomAccess } from "./api/_lib/central-auth";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "WIS Live Command Center",
  description: "WIS 抖店直播数据中心与 SQL 分析工作台。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const requestHeaders = await headers();
  const auth = await requireLiveRoomAccess(new Request("https://internal.local/", { headers: requestHeaders }));
  if (!auth.ok) {
    const title = auth.status === 401 ? "请先从 WIS 品牌营销中枢登录" : auth.status === 503 ? "统一权限服务暂时不可用" : "当前账号无权访问数据中心";
    return (
      <html lang="zh-CN">
        <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
          <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#f5f7f5", padding: 20 }}>
            <section style={{ width: "min(440px, 100%)", padding: 32, border: "1px solid #e1e8e4", borderRadius: 16, background: "#fff", boxShadow: "0 18px 60px rgba(26,69,49,.09)" }}>
              <h1 style={{ margin: "0 0 12px", fontSize: 22 }}>{title}</h1>
              <p style={{ color: "#69766f", lineHeight: 1.7 }}>登录状态与界面权限由 WIS 品牌营销中枢统一管理。</p>
              <a href={process.env.HUB_SAME_ORIGIN_EMBED === "true" ? "/yxb/wis-marketing-hub/" : "https://app.fandow.top/fd-026222/wis-marketing-hub/"} target="_top" rel="noreferrer" style={{ display: "inline-block", marginTop: 12, padding: "10px 16px", borderRadius: 9, background: "#166b4b", color: "#fff", textDecoration: "none", fontWeight: 700 }}>返回中枢</a>
            </section>
          </main>
        </body>
      </html>
    );
  }
  return (
    <html lang="zh-CN">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
