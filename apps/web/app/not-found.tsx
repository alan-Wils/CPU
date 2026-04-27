import Link from "next/link";

export default function NotFound() {
  return (
    <main style={{ padding: 24, color: "#0f172a" }}>
      <h1>Not found</h1>
      <p>
        <Link href="/">Home</Link> · <Link href="/check-capture">Check capture</Link>
      </p>
    </main>
  );
}
