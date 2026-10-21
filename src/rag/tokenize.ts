const STOP = new Set(
  ('a an the and or but if then else of to in on at by for with from as is are was were be been being this that these those it its ' +
    'into over under than so such can could should would will may might must do does did done have has had having not no nor ' +
    'you your we our they their he she his her them i me my what which who whom when where why how all any each few more most ' +
    'other some only own same too very just also there here about after before again further once both up down out off ' +
    'use uses used using via per let lets one two get gets make makes like new etc while within without').split(' '),
);

/** Splits camelCase / snake_case / paths so `parseGithubUrl` matches a query about "github url parsing". */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  const raw = text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/);
  for (const w of raw) {
    if (w.length < 2 || STOP.has(w) || /^\d+$/.test(w)) continue;
    out.push(stem(w));
  }
  return out;
}

/** Tiny suffix stripper; good enough to match "parses"/"parsing"/"parser" without a dependency. */
export function stem(w: string): string {
  if (w.length <= 4) return w;
  for (const suf of ['ations', 'ation', 'ings', 'ing', 'ers', 'ies', 'ied', 'er', 'ed', 'es', 'ly', 's']) {
    // "-es" is only a suffix after s/x/z/ch/sh ("boxes"); otherwise "sources" → "source" via "-s".
    if (suf === 'es' && !/(s|x|z|ch|sh)es$/.test(w)) continue;
    if (w.endsWith(suf) && w.length - suf.length >= 3) {
      const base = w.slice(0, -suf.length);
      return suf === 'ies' || suf === 'ied' ? base + 'y' : base;
    }
  }
  return w;
}

/** Identifiers, file names, numbers and quoted terms: the parts of a sentence that must not be invented. */
export function specificTerms(sentence: string): string[] {
  const terms = new Set<string>();
  for (const m of sentence.matchAll(/`([^`]+)`/g)) terms.add(m[1]);
  for (const m of sentence.matchAll(/\b[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+\b/g)) {
    if (!/^(e\.g|i\.e|etc)$/i.test(m[0])) terms.add(m[0]);
  }
  for (const m of sentence.matchAll(/\b[a-z]+[A-Z][A-Za-z0-9]*\b/g)) terms.add(m[0]); // camelCase
  for (const m of sentence.matchAll(/\b[a-z0-9]+_[a-z0-9_]+\b/g)) terms.add(m[0]); // snake_case
  for (const m of sentence.matchAll(/\b\d[\d,.]*\s?(?:%|k|K|M|ms|MB|GB|x)?(?=\W|$)/g)) {
    const n = m[0].trim().replace(/[.,]+$/, '');
    if (n.replace(/[^0-9]/g, '').length >= 2) terms.add(n);
  }
  return [...terms];
}
