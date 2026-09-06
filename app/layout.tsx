import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '金融客诉智能协同工作台',
  description: '基于证据链与人工审批的金融客诉智能调查系统',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
