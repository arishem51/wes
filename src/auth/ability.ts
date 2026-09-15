import {
  createMongoAbility,
  ForcedSubject,
  MongoAbility,
  RawRuleOf,
} from '@casl/ability';
import { ALL_PERMISSION_KEYS } from './permission.catalogue';

export type AppSubject =
  | 'Capability'
  | 'Map'
  | 'Area'
  | 'Vehicle'
  | 'Order'
  | 'Cargo'
  | 'Fleet'
  | 'Path'
  | 'User'
  | 'Role'
  | 'Token'
  | 'Agv'
  | 'DispatchPolicy'
  | 'List';
/** Tagged instance shapes for the two subjects that carry a resource condition (see `PERMISSION_POLICIES`). */
type MapInstance = { id: string } & ForcedSubject<'Map'>;
type AreaInstance = { mapRecordId: string } & ForcedSubject<'Area'>;
export type AppAbility = MongoAbility<
  [string, AppSubject | MapInstance | AreaInstance]
>;
export type AuthorizationRules = RawRuleOf<AppAbility>[];

/** Capability keys remain the DB/API contract. This is the only domain mapping. */
export const PERMISSION_POLICIES: Record<
  string,
  [string | string[], AppSubject]
> = {
  'map.view': ['read', 'Map'],
  'list.view': ['read', 'List'],
  'map.upload': [['upload', 'load'], 'Map'],
  'map.download': ['download', 'Map'],
  'area.create': ['create', 'Area'],
  'area.edit': ['update', 'Area'],
  'area.delete': ['delete', 'Area'],
  'area.sync_kernel': ['sync', 'Area'],
  'vehicle.pause': [['pause', 'resume'], 'Vehicle'],
  'vehicle.integration_level': ['integration_level', 'Vehicle'],
  'vehicle.comm_adapter': ['comm_adapter', 'Vehicle'],
  'vehicle.send_to_point': ['send_to_point', 'Vehicle'],
  'vehicle.withdraw': ['withdraw', 'Vehicle'],
  'order.create': ['create', 'Order'],
  'order.withdraw': ['withdraw', 'Order'],
  'cargo.create': ['create', 'Cargo'],
  'cargo.cancel': ['cancel', 'Cargo'],
  'cargo.redirect': ['redirect', 'Cargo'],
  'fleet.control': ['control', 'Fleet'],
  'path.lock': ['lock', 'Path'],
  'users.view': ['read', 'User'],
  'users.manage': ['manage', 'User'],
  'roles.manage': ['manage', 'Role'],
  'tokens.manage': ['manage', 'Token'],
  'agvs.manage': ['manage', 'Agv'],
  'dispatch.manage': ['manage', 'DispatchPolicy'],
};

export function createAppAbility(
  permissions: readonly string[],
  mapIds?: readonly string[],
): AppAbility {
  const rules: AuthorizationRules = [];
  for (const key of new Set(permissions)) {
    if (!ALL_PERMISSION_KEYS.includes(key)) continue;
    rules.push({ action: key, subject: 'Capability' });
    const policy = PERMISSION_POLICIES[key];
    if (!policy) continue;
    const [action, subject] = policy;
    const scoped =
      mapIds !== undefined && (subject === 'Map' || subject === 'Area');
    rules.push({
      action,
      subject,
      ...(scoped
        ? {
            conditions: {
              [subject === 'Map' ? 'id' : 'mapRecordId']: { $in: [...mapIds] },
            },
          }
        : {}),
    });
  }
  return createMongoAbility<AppAbility>(rules);
}
