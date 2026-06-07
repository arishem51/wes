import { Icon } from '@/ui/icons';
import { PERMISSIONS } from '@/mocks/adminUsers';
import type { TFunc } from '@/i18n';
import type { PermGroup, Role } from '@/types/adminUser';

const GROUPS: PermGroup[] = ['pg_fleet', 'pg_map', 'pg_requests', 'pg_dispatch', 'pg_dashboard', 'pg_users', 'pg_audit'];
const LVL_ICON = { full: 'check', view: 'eye', none: 'x' } as const;
const LVL_LABEL = { full: 'lvl_full', view: 'lvl_view', none: 'lvl_none' } as const;

export function PermissionList({ role, t }: { role: Role; t: TFunc }) {
  const perms = PERMISSIONS[role];
  return (
    <div className="perm-list">
      {GROUPS.map((g) => {
        const lvl = perms[g] || 'none';
        return (
          <div key={g} className="perm-row">
            <span className="perm-row-l">{t(g)}</span>
            <span className={'perm-lvl ' + lvl}>
              <Icon name={LVL_ICON[lvl]} size={13} stroke={2.4} />
              {t(LVL_LABEL[lvl])}
            </span>
          </div>
        );
      })}
    </div>
  );
}
