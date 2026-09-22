import type { Capability } from '../../api/contract';

export type CapabilityGroup = { resource: string; label: string; items: Capability[] };

/** Группирует права по разделу (resource), сохраняя порядок каталога. */
export function groupCapabilities(caps: Capability[]): CapabilityGroup[] {
  const map = new Map<string, CapabilityGroup>();
  for (const c of caps) {
    let g = map.get(c.resource);
    if (!g) { g = { resource: c.resource, label: c.resourceLabel, items: [] }; map.set(c.resource, g); }
    g.items.push(c);
  }
  return Array.from(map.values());
}
