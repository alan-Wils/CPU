"use client";

import FacilitiesMaintenanceClient from "@/components/facilities/FacilitiesMaintenanceClient";
import PageAccessGate from "@/components/PageAccessGate";

export default function FacilitiesMaintenancePage() {
  return (
    <PageAccessGate permission="page.facilities-maintenance">
      <FacilitiesMaintenanceClient />
    </PageAccessGate>
  );
}
