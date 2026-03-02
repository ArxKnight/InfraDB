import type { SiteLocation } from '../types';

export function safeText(value: unknown): string {
  return (value ?? '').toString().trim();
}

export function getEffectiveLabel(loc: SiteLocation, fallbackSiteCode?: string): string {
  const fromApi = safeText((loc as any).effective_label);
  if (fromApi) return fromApi;

  const fromLabel = safeText(loc.label);
  if (fromLabel) return fromLabel;

  const fallback = safeText(fallbackSiteCode);
  if (fallback) return fallback;

  return 'Site';
}

function normalizeArea(value: unknown): string {
  const raw = safeText(value);
  if (!raw) return '';
  return raw.replace(/\s+/g, ' ');
}

function stripRackSizeSegment(value: unknown): string {
  const raw = safeText(value);
  if (!raw) return '';
  return raw
    .replace(/\s*\|\s*Rack\s*Size\s*:\s*[^|]+/gi, '')
    .replace(/\s*Rack\s*Size\s*:\s*\d+\s*U\s*$/gi, '')
    .trim();
}

export function isDomesticLocation(loc: SiteLocation): boolean {
  const template = safeText((loc as any).template_type).toUpperCase();
  if (template === 'DOMESTIC') return true;
  if (template === 'DATACENTRE') return false;

  const area = normalizeArea((loc as any).area);
  const hasDcFields = safeText(loc.suite) !== '' || safeText(loc.row) !== '' || safeText(loc.rack) !== '';
  return area !== '' && !hasDcFields;
}

// Section 4A display: field-based, fixed ordering, fixed separators.
export function formatLocationFields(loc: SiteLocation): string {
  const label = getEffectiveLabel(loc);
  const floor = safeText(loc.floor);

  if (isDomesticLocation(loc)) {
    const area = normalizeArea((loc as any).area);
    return `Label: ${label} | Floor: ${floor} | Area: ${area}`;
  }

  const suite = safeText(loc.suite);
  const row = safeText(loc.row);
  const rack = stripRackSizeSegment(loc.rack);
  return `Label: ${label} | Floor: ${floor} | Suite: ${suite} | Row: ${row} | Rack: ${rack}`;
}

// UI display format (lists, admin screens, etc):
//   <LocationLabel> — Label: <SiteAbbrev> | Floor: <Floor> | Suite: <Suite> | Row: <Row> | Rack: <Rack>
export function formatLocationDisplay(loc: SiteLocation, siteAbbrev: string): string {
  const siteCode = safeText(siteAbbrev);
  const locationLabel = getEffectiveLabel(loc, siteCode);
  const base = formatLocationFields({ ...loc, label: locationLabel } as SiteLocation);
  return `${locationLabel} — ${base}`;
}

// ZPL print format (cross-rack label output):
//   <LocationLabel>/<Floor>/<Suite>/<Row>/<Rack>
export function formatLocationPrint(loc: SiteLocation): string {
  const label = getEffectiveLabel(loc);
  const floor = safeText(loc.floor);

  if (isDomesticLocation(loc)) {
    const area = normalizeArea((loc as any).area);
    return `${label}/${floor}/${area}`;
  }

  return `${label}/${floor}/${safeText(loc.suite)}/${safeText(loc.row)}/${stripRackSizeSegment(loc.rack)}`;
}

export function formatLocationWithPrefix(prefix: string, loc: SiteLocation): string {
  const prefixClean = safeText(prefix) || 'Site';
  return `${prefixClean} — ${formatLocationFields(loc)}`;
}

export function locationHierarchyKeys(loc: SiteLocation): {
  label: string;
  floor: string;
  suite: string;
  row: string;
  rack: string;
} {
  return {
    label: getEffectiveLabel(loc),
    floor: safeText(loc.floor) || 'Unspecified',
    suite: safeText(loc.suite) || 'Unspecified',
    row: safeText(loc.row) || 'Unspecified',
    rack: safeText(loc.rack) || 'Unspecified',
  };
}
