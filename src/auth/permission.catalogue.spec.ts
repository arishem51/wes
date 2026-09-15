import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  ALL_PERMISSION_KEYS,
  PERMISSION_CATALOGUE,
  SYSTEM_ROLE_GRANTS,
} from './permission.catalogue';

function controllerFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...controllerFiles(full));
    else if (entry.name.endsWith('.controller.ts')) out.push(full);
  }
  return out;
}

describe('permission catalogue', () => {
  it('has unique keys', () => {
    expect(new Set(ALL_PERMISSION_KEYS).size).toBe(ALL_PERMISSION_KEYS.length);
  });

  it('grants only keys that exist in the catalogue', () => {
    const known = new Set(ALL_PERMISSION_KEYS);
    for (const [role, keys] of Object.entries(SYSTEM_ROLE_GRANTS)) {
      for (const key of keys) {
        expect({ role, key, known: known.has(key) }).toEqual({
          role,
          key,
          known: true,
        });
      }
    }
  });

  it('admin is granted every permission', () => {
    expect([...SYSTEM_ROLE_GRANTS.admin].sort()).toEqual(
      [...ALL_PERMISSION_KEYS].sort(),
    );
  });

  it('every @RequirePermissions key in a controller exists in the catalogue', () => {
    const known = new Set(ALL_PERMISSION_KEYS);
    const files = controllerFiles(resolve(__dirname, '..'));
    const used = new Set<string>();
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      const re = /@RequirePermissions\(([^)]*)\)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src))) {
        for (const lit of m[1].matchAll(/['"]([^'"]+)['"]/g)) used.add(lit[1]);
      }
    }
    expect(used.size).toBeGreaterThan(0);
    for (const key of used) {
      expect({ key, known: known.has(key) }).toEqual({ key, known: true });
    }
  });

  it('every catalogue entry has a cluster and labels', () => {
    for (const p of PERMISSION_CATALOGUE) {
      expect(p.cluster).toBeTruthy();
      expect(p.labelVi && p.labelEn && p.labelJa).toBeTruthy();
    }
  });
});
