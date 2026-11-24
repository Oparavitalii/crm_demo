// Deterministic slug generator for the per-user public application form
// URL. ASCII lowercase, dash-separated. Same set of replacements as the
// SQL backfill in migration 0047 — keep the two in sync if either side
// changes (DB-side backfill must match the runtime fallback for new
// users created after the migration ran).
//
// Latin diacritics + Polish + Ukrainian (Cyrillic) → ASCII. Everything
// else collapses to a single dash. Leading / trailing dashes trimmed.

const DIACRITIC_MAP: Record<string, string> = {
  // Polish
  ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z',
  // Czech / common Latin
  á: 'a', é: 'e', í: 'i', ú: 'u', ý: 'y', č: 'c', ď: 'd', ě: 'e', ň: 'n',
  ř: 'r', š: 's', ť: 't', ů: 'u', ü: 'u', ö: 'o', ä: 'a', ß: 'ss',
  // Ukrainian (and overlap with Russian Cyrillic where letter shape matches)
  а: 'a', б: 'b', в: 'v', г: 'h', ґ: 'g', д: 'd', е: 'e', є: 'ie', ж: 'zh',
  з: 'z', и: 'y', і: 'i', ї: 'i', й: 'i', к: 'k', л: 'l', м: 'm', н: 'n',
  о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts',
  ч: 'ch', ш: 'sh', щ: 'shch', ь: '', ю: 'iu', я: 'ia',
};

export function slugify(input: string): string {
  const lower = input.toLowerCase().normalize('NFC');
  let out = '';
  for (const ch of lower) {
    out += DIACRITIC_MAP[ch] ?? ch;
  }
  return out
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Build a slug from first/last name. Falls back to "user" if both empty.
export function buildUserSlug(firstName: string, lastName: string): string {
  const base = slugify(`${firstName} ${lastName}`);
  return base || 'user';
}
