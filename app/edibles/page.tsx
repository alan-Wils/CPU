"use client";

import Nav from "@/components/Nav";
import PageAccessGate from "@/components/PageAccessGate";
import EdiblesClient from "@/components/edibles/EdiblesClient";

export default function EdiblesPage() {
  return (
    <PageAccessGate permission="page.edibles">
      <Nav />
      <EdiblesClient />
    </PageAccessGate>
  );
}
