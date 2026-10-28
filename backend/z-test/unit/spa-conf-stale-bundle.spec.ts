/**
 * [FIX-20260830-STALEBUNDLE] the local SPA mirror must not hide a stale bundle.
 *
 * `docs/local-traefik/spa.conf` used to carry one rule — `try_files $uri $uri/
 * /index.html` — so ANY path with no file behind it answered 200 with the SPA
 * page. Verified against the running stack on 30/08: a chunk deleted weeks
 * earlier still returned 200, which means a browser holding an old index.html
 * was handed HTML where it expected JavaScript. The failure then looks like a
 * bug in the app, and an afternoon was spent proving it was not one.
 *
 * These pin the two rules that close that hole. They read the file rather than
 * the running container on purpose: the config is the artefact that ships, and
 * a test that needs docker up is a test that gets skipped.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const conf = readFileSync(
  join(__dirname, '../../../deploy/traefik/spa.conf'),
  'utf8',
);

/** the body of a `location <match> { ... }` block, or null when absent.
 *  ⚠️ The match must be ANCHORED to the end of the directive: a plain
 *     `indexOf('location /')` finds `location /assets/` first and then asserts
 *     against the wrong block — which is exactly how this helper was written
 *     the first time, and the test passed for the wrong reason until the
 *     catch-all assertion happened to fail. */
function locationBlock(match: string): string | null {
  const at = conf.search(
    new RegExp(`location\\s+${match.replace(/[/=]/g, '\\$&')}\\s*\\{`),
  );
  if (at === -1) return null;
  const open = conf.indexOf('{', at);
  const close = conf.indexOf('}', open);
  return open === -1 || close === -1 ? null : conf.slice(open + 1, close);
}

describe('spa.conf — a stale bundle must fail loudly', () => {
  it('⭐ hashed assets 404 instead of falling through to index.html', () => {
    const block = locationBlock('/assets/');
    expect(block).not.toBeNull();
    /* =404 is the whole point: the filename carries a content hash, so a name
       that is not on disk is a stale reference, never a client-side route */
    expect(block).toMatch(/try_files\s+\$uri\s+=404\s*;/);
    expect(block).not.toContain('/index.html');
  });

  it('⭐ index.html is never cached — it is the map to every chunk name', () => {
    const block = locationBlock('= /index.html');
    expect(block).not.toBeNull();
    expect(block).toMatch(/add_header\s+Cache-Control\s+"no-store"/);
  });

  it('the SPA fallback itself is still there — client-side routes must work', () => {
    const block = locationBlock('/');
    expect(block).toMatch(/try_files\s+\$uri\s+\$uri\/\s+\/index\.html\s*;/);
  });

  it('🔴 the /assets/ rule is declared BEFORE the catch-all', () => {
    /* nginx picks the longest prefix match, so order does not decide this one —
       but a reader who reorders them is one edit away from reintroducing the
       bug, and this states the intent where they will see it. */
    expect(conf.indexOf('location /assets/')).toBeLessThan(
      conf.search(/location\s+\/\s*\{/),
    );
  });
});
