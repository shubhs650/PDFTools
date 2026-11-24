// The file-name rule of a CRS template (M13-07, D-71, C10): "{docNo}_Rev{rev}"
// reads "PA-1200-ME-DWG-0042_RevB.pdf" as document number PA-1200-ME-DWG-0042
// and revision B. Placeholders: {docNo}, {rev}, {title} and {*} (anything,
// ignored). Literal text matches without regard to case; ".pdf" is not part
// of the name. The export dialog prefills from it and stays editable. Pure.
import { ruleParts } from './template';

export interface RuleValues {
  docNo?: string;
  rev?: string;
  title?: string;
}

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

/** The values `rule` reads from `fileName`, or null when the name does not fit it. */
export function readFileName(rule: string, fileName: string): RuleValues | null {
  const parts = ruleParts(rule.trim());
  if (!parts) return null;
  const base = fileName.replace(/\.pdf$/iu, '').trim();
  const names: string[] = [];
  let source = '^';
  parts.forEach((p, i) => {
    if (typeof p === 'string') {
      source += escape(p);
      return;
    }
    names.push(p.field);
    // Lazy, except the last placeholder, which takes the rest.
    source += i === parts.length - 1 ? '(.+)' : '(.+?)';
  });
  const m = new RegExp(`${source}$`, 'iu').exec(base);
  if (!m) return null;
  const out: RuleValues = {};
  names.forEach((field, i) => {
    const v = (m[i + 1] ?? '').trim();
    if (field === 'docNo' || field === 'rev' || field === 'title') out[field] = v;
  });
  return out;
}
