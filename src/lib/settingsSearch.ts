/** Match every query term against a section's label, id, and task aliases. */
export function matchesSettingsSearch(label: string, id: string, keywords: string[], query: string): boolean {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const haystack = [label, id, ...keywords].join(' ').toLowerCase();
  return terms.every(term => haystack.includes(term));
}
