# WES Evaluation Runbook — trigger AGVs · run scenarios · record `runs` · clean up

Operational reference for stress-testing the MAPF/dispatch pipeline against the live
openTCS kernel through the **WES API**, recording each experiment as a `runs` row,
and classifying the outcome (`complete` / `deadlock`).

Everything here talks to three live services:

| Service | URL | Start |
|---|---|---|
| WES backend (HTTP API) | `http://localhost:3000/api` | `pnpm start:dev` (in `wes/`) |
| openTCS kernel | `http://localhost:55200` | (Java kernel, started separately) |
| Postgres | `postgres://postgres:postgres@127.0.0.1:5432/wes` | — |

Admin login: **`quan.tran` / `Wes@1234`** (note: not the `Admin@123` shown in `seed.ts`).

---

## 0. Auth — get a token

```bash
BASE=http://localhost:3000/api
TOKEN=$(curl -s -m 5 -X POST $BASE/auth/login \
  -H "content-type: application/json" \
  -d '{"username":"quan.tran","password":"Wes@1234"}' \
  | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
[ -z "$TOKEN" ] && echo "LOGIN FAILED (WES backend down?)"
```

`HTTP 000` from any WES call = backend is down → start it with `pnpm start:dev`.

---

## 1. Trigger vehicles (via WES API — do NOT set position on the kernel directly)

Use the WES API because `POST /agvs/:id/connect` does extra config the kernel call
doesn't: enables the comm-adapter **and** sets the loopback `loadOperation=PICK_UP`,
`unloadOperation=DROP_OFF`, `operatingTime=2000`, **and** integration level
`TO_BE_UTILIZED`. Then `POST /agvs/:id/position` places the vehicle.

Standard 10-vehicle layout:

| Vehicles | Points |
|---|---|
| Vehicle-0001 … 0005 | 1001, 1002, 1003, 1004, 1005 |
| Vehicle-0006 … 0010 | 0210, 0220, 0230, 0240, 0250 |

```bash
# Trigger Vehicle-0001..0010 at the standard layout.
curl -s -m 5 "$BASE/agvs?limit=200" -H "authorization: Bearer $TOKEN" -o /tmp/agvs.json
python -c "
import json
d=json.load(open('/tmp/agvs.json'))
m={a['name']:a['id'] for a in d['agvs']}
pts={'Vehicle-0001':'1001','Vehicle-0002':'1002','Vehicle-0003':'1003','Vehicle-0004':'1004','Vehicle-0005':'1005',
     'Vehicle-0006':'0210','Vehicle-0007':'0220','Vehicle-0008':'0230','Vehicle-0009':'0240','Vehicle-0010':'0250'}
for n in ['Vehicle-%04d'%i for i in range(1,11)]: print(n, m.get(n,'MISSING'), pts[n])
" | tr -d '\r' > /tmp/act.txt

while read -r N ID PT; do
  C=$(curl -s -o /dev/null -w "%{http_code}" -m 30 -X POST "$BASE/agvs/$ID/connect" -H "authorization: Bearer $TOKEN")
  P=$(curl -s -o /dev/null -w "%{http_code}" -m 30 -X POST "$BASE/agvs/$ID/position" \
        -H "authorization: Bearer $TOKEN" -H "content-type: application/json" -d "{\"pointName\":\"$PT\"}")
  echo "$N connect=$C position($PT)=$P"
done < /tmp/act.txt
```

Both calls should return `204`.

**Gotchas**
- On Windows/Git-Bash, the `python`/`node` intermediate files get **CRLF** — always
  `tr -d '\r'` before `while read`, or the trailing `\r` corrupts the URL and curl returns `000`.
- After a **kernel restart**, all vehicles reset to `integrationLevel=TO_BE_RESPECTED`,
  `currentPosition=null` → they are NOT dispatchable; re-trigger them.
- `position` returns **500** when the target point is already occupied by another vehicle
  (kernel refuses to teleport onto an occupied point). Pick a free point, or restart the
  kernel to clear positions. Any distinct valid point works — the exact layout isn't required.

Check kernel/vehicle state:

```bash
python -c "
import json,urllib.request,collections
d=json.load(urllib.request.urlopen('http://localhost:55200/v1/vehicles',timeout=5))
v=[x for x in d if x['name'] in ['Vehicle-%04d'%i for i in range(1,11)]]
print('integ:', dict(collections.Counter(x.get('integrationLevel') for x in v)),
      '| positioned:', sum(1 for x in v if x.get('currentPosition')))
o=json.load(urllib.request.urlopen('http://localhost:55200/v1/transportOrders',timeout=5))
print('open orders:', len([t for t in o if t.get('state') not in ('FINISHED','FAILED','WITHDRAWN','UNROUTABLE')]))
"
```

To add more vehicles (e.g. 5 more at 0230–0270), first confirm the target points are
**free** in `/v1/vehicles` (avoid the 500), then trigger `Vehicle-0011..0015` the same way.

---

## 2. Run a scenario (records a `runs` row)

`scripts/run-scenario.js` opens a `runs` row (`started_at`), POSTs the scenario's cargo
through the real WES API (release + assignment engines run for real), polls
`GET /api/cargo` until every posted cargo hits a terminal `taskStatus`
(`DELIVERY_COMPLETED` / `FAILED` / `CANCELLED`) or the timeout, then closes the row
(`ended_at`).

```bash
cd wes
node scripts/run-scenario.js scripts/scenarios/bidir-70-2zone.json
```

**`TIMEOUT_MS` matters — the default 600000 (10 min) is TOO SHORT for the 80-cargo runs**
(which finish in ~8–14 min). If the poll window expires before the fleet finishes, the run
is mislabeled `timeout: N unfinished` even though it later completes. For heavy runs:

```bash
TIMEOUT_MS=1200000 node scripts/run-scenario.js scripts/scenarios/fullpick-80-4zone.json
```

Other env: `WES_BASE_URL` (default `http://localhost:3000/api`), `WES_USER`, `WES_PASS`,
`POLL_MS`, `DATABASE_URL` (required).

The vehicles must already be triggered (§1) or nothing gets dispatched.

---

## 3. Verify completion vs deadlock — ALWAYS check the DB, don't trust the poll timeout

"`N unfinished` at timeout" ≠ deadlock. The script only stops **polling**; the fleet keeps
working in the kernel. Query the batch's real state (batch = cargo created at/after the run's
`started_at`):

```bash
cd wes
node -e "
const {Client}=require('pg');
(async()=>{
  const db=new Client({connectionString:'postgres://postgres:postgres@127.0.0.1:5432/wes'});await db.connect();
  const RUN=process.argv[1];
  const s=(await db.query('select started_at from runs where id=\$1',[RUN])).rows[0].started_at;
  const st=await db.query(\`select tr.status,count(*) from transport_requests tr join cargos c on c.id=tr.cargo_id
     where c.created_at>=\$1 group by tr.status order by 2 desc\`,[s]);
  console.log('batch statuses NOW:', st.rows);
  const last=await db.query(\`select t.occurred_at, c.item_code, c.source_point_name, t.vehicle_name
     from task_status_transitions t join transport_requests tr on tr.id=t.task_id join cargos c on c.id=tr.cargo_id
     where c.created_at>=\$1 and t.to_status='DELIVERY_COMPLETED' order by t.occurred_at desc limit 1\`,[s]);
  console.log('last delivered:', last.rows[0], '| started:', s);
  await db.end();
})().catch(e=>{console.error(e.message);process.exit(1)});
" <RUN_ID>
```

- All `DELIVERY_COMPLETED` → **complete** (was just slow). Set `ended_at` to the last
  delivery time so the analysis window is honest:
  `update runs set ended_at='<last occurred_at>' where id=<RUN_ID>;`
- Some tasks stuck non-terminal (`DELIVERING`/`PICKING_UP`/`BLOCKED`) with no progress to the
  end of a generous window → **real deadlock**. Record which cargo/vehicles are stuck.

---

## 4. Mark a run's outcome

Convention: append ` | reason: <complete|deadlock|exception|failed>` to `runs.notes`
so runs are queryable by reason.

```bash
cd wes
node -e "
const {Client}=require('pg');
(async()=>{
  const db=new Client({connectionString:'postgres://postgres:postgres@127.0.0.1:5432/wes'});await db.connect();
  const RUN=process.argv[1], REASON=process.argv[2];
  const r=await db.query(
    \"update runs set notes = notes || ' | reason: '||\$2 where id=\$1 and notes not like '%reason: '||\$2||'%' returning id, notes\",
    [RUN, REASON]);
  console.log(r.rows[0]);
  await db.end();
})().catch(e=>{console.error(e.message);process.exit(1)});
" <RUN_ID> <complete|deadlock|exception|failed>
```

If you abort a still-running run early (killed the runner before it closed), also bound it:
`update runs set ended_at=coalesce(ended_at,now()) where id=<RUN_ID>;`

To stop only the scenario runner (never `taskkill /IM node.exe` — that kills the WES server
and frontend too):

```powershell
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -like '*run-scenario.js*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
```

---

## 5. Clean up cargo + tasks (between batches)

Do it in the **DB**, not via `DELETE /cargo/:id` — the API withdraws the kernel order first
and 500s when the order is already gone (`PICKING_UP` tasks). The DB path mirrors the API's
effect: cancel non-terminal tasks + soft-delete cargo (frees drop-off zone slots).

```bash
cd wes
node -e "
const {Client}=require('pg');
(async()=>{
  const db=new Client({connectionString:'postgres://postgres:postgres@127.0.0.1:5432/wes'});await db.connect();
  const t=await db.query(\"update transport_requests tr set status='CANCELLED', cancelled_at=now(), updated_at=now()
     from cargos c where tr.cargo_id=c.id and c.deleted_at is null
     and tr.status not in ('CANCELLED','FAILED','DELIVERY_COMPLETED') returning tr.id\");
  const cg=await db.query('update cargos set deleted_at=now(), updated_at=now() where deleted_at is null returning id');
  console.log('tasks cancelled:', t.rowCount, '| cargos soft-deleted:', cg.rowCount);
  await db.end();
})().catch(e=>{console.error(e.message);process.exit(1)});
"
```

Vehicles are left as-is; a kernel restart clears them (and you re-trigger per §1).

---

## Scenario files & gotchas

- **One waiting cargo per source point.** WES rejects a second cargo on a point that already
  has an active one (`Point "X" already has cargo waiting`). A scenario that repeats source
  points only posts the distinct ones.
  - `bidir-70-2zone.json` lists 70 entries but only **30 distinct** points → 30 accepted, 40 rejected.
  - `fullpick-80-4zone.json` uses **80 distinct** points (0100–0179) → all 80 accepted.
- **Pickup points:** 80 valid PICK_UP-linked points `0100`–`0179` (from `GET /maps/cargo-options`).
- **Drop-off zones:** only **4 are real** — `â` `21ccd4b4…`, `aa` `d36c73a8…`, `b` `1f1acde2…`,
  `bbb` `18098f7b…` (36 slots each). Other "active-looking" zones (`a`, the 16-slot `aa`,
  `zone B`) are **soft-deleted** (`zones.deleted_at` set) so cargo-create rejects them
  (`Khu trả hàng không tồn tại hoặc không hoạt động`). "Full zones" therefore = these 4.
- **Zone capacity:** `ACTIVE`+`DELIVERED` cargo occupy slots until soft-deleted. 4×36 = 144
  slots; clean up between batches so zones don't fill.
- **`fullpick-80-4zone.json`**: 80 cargo, one per pickup slot, round-robin **20 per zone**
  across the 4 real zones. Regenerate it with:
  ```bash
  node -e "const fs=require('fs');
  const Z=['21ccd4b4-eab2-4fa0-8c5d-93ea697d17a5','d36c73a8-bbff-4f91-bcce-be87b79883c1','1f1acde2-3846-4bb7-8bcf-badf82715046','18098f7b-dbab-4dae-9fce-7c2ab48fd3f2'];
  const c=[]; for(let p=100,i=0;p<180;p++,i++) c.push({atMs:0,sourcePointName:String(p).padStart(4,'0'),destinationZoneId:Z[i%4]});
  fs.writeFileSync('scripts/scenarios/fullpick-80-4zone.json', JSON.stringify({label:'fullpick_80cargo_4zone_10agv',notes:'Full pickup, 20/zone, 4 dropoff zones.',cargos:c},null,2)+'\n');"
  ```

---

## Observed baseline (v7-bidir, this environment)

| Scenario | Fleet | Typical result |
|---|---|---|
| `bidir-70-2zone` (30 effective) | 10 | ~complete in ~5 min; occasionally deadlocks (plan-shape nondeterminism) |
| `fullpick-80-4zone` (80) | 10 | complete ~9 min; sometimes a few tasks stuck (real deadlock) |
| `fullpick-80-4zone` (80) | 15 | complete ~7 min, no deadlock |

Deadlock frequency is **nondeterministic** and load-sensitive; judge solver changes over
several runs, not one.

---

## DB quick reference

| Table | Key columns |
|---|---|
| `runs` | `id`, `label`, `notes`, `started_at`, `ended_at` |
| `cargos` | `id`, `status` (ACTIVE/DELIVERED/CANCELLED), `destination_zone_id`, `deleted_at` (soft-delete) |
| `transport_requests` | `id`, `cargo_id`, `status` (CREATED→READY_TO_ASSIGN→BLOCKED→PICKING_UP→DELIVERING→DELIVERY_COMPLETED / CANCELLED / FAILED), `cancelled_at`, `metadata` (jsonb) |
| `task_status_transitions` | `task_id`, `to_status`, `occurred_at`, `vehicle_name` — insert-only audit; source of truth for timing |
| `zones` | `id`, `name`, `type` (PICKUP/DROPOFF), `status`, `deleted_at` |
| `zone_members` | `zone_id`, `location_name` — one row per slot |

Analysis cuts transitions by the `[started_at, ended_at]` window of a `runs` row.
