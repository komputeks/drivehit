import "./globals.css";

export const metadata = {
  title: "DriveHit Platform",
  description: "Enterprise Drive Content Platform"
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        {children}
      </body>
    </html>
  );
}
