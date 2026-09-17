"use client";

import { useTenant } from "./layout";

export default function TenantHome() {
  const tenant = useTenant();
  return <h1 className="p-8 text-2xl font-semibold">{tenant.name}</h1>;
}
