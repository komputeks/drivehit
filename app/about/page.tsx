import Link from "next/link";

export default function Home() {
  return (
    <main className="container">
      <h1 className="text-3xl font-bold mb-4">
        About this  Platform
      </h1>

      <p className="mb-6">
        Content ingestion & gallery system.
      </p>

      <Link href="/admin" className="btn">
        Go to your Home
      </Link>
    </main>
  );
}
