# Customer DB Statistics

This file captures the query results obtained from the customer `aubot-fms` database through the verified SSH tunnel workflow documented in [README.md](/abs/path/C:/Users/Phung%20Van%20Hung/Desktop/aubot/FMS-SRC/README.md).

## Connection Context

- Server: `aubot-wcs-kernel-jp`
- Tunnel target: `ssh -L 15432:172.18.0.2:5432 root@220.158.25.6`
- Database: `aubot-fms`
- User: `admin`
- Password used for querying: `Aubot@2025`

## Data Coverage

Query result:

```text
source                          min_ts                   max_ts                   rows
transport_order.created_time    2026-04-13 07:46:17.82  2026-05-18 10:50:17.664  6294
transport_order.finished_at     2026-04-13 07:46:22.758 2026-05-18 09:44:27.8    3875
cargo.create_at                 2026-04-13 08:24:50.161 2026-05-18 01:57:11.169  3135
vehicle_history.time_log        2026-04-13 07:46:07.049 2026-05-18 16:11:01.06   50994
vehicle_route_history.complete_at NULL                    NULL                    0
vehicle_error_history.started_at 2026-04-18 05:34:42.006 2026-05-18 08:08:28.92  2597
```

Implications:

- There is enough real data for order, vehicle state, and vehicle error analysis.
- `vehicle_route_history` is currently empty, so route-usage bottleneck analysis cannot rely on that table.

## Current Fleet Size

Query result:

```text
active_vehicles
11
```

Vehicle type distribution:

```text
type  vehicles
B300  11
```

## Busiest Days

Top 10 days by `transport_order.created_time`:

```text
day         transport_orders  finished_orders  failed_orders
2026-04-21  1874              1044             829
2026-04-23  1324              708              613
2026-04-20  1001              826              159
2026-04-18  664               223              360
2026-05-14  434               352              82
2026-05-07  246               170              75
2026-04-30  202               147              54
2026-05-18  158               120              34
2026-04-22  108               91               17
2026-05-08  74                50               24
```

The rest of this report focuses on `2026-04-21`, the busiest day currently found in the DB.

## Daily KPI Summary for 2026-04-21

```text
total_orders            1874
finished_orders         1044
failed_orders           829
assigned_orders         1874
active_vehicles         11
avg_assign_seconds      309
avg_total_seconds       780
avg_post_assign_seconds 255
```

Observations:

- Every order on this day has `vehicle_assigned_time`.
- The fail rate is very high: `829 / 1874`, about `44.2%`.
- Average end-to-end completion time is about `13` minutes.
- Average time from creation to assignment is about `5` minutes.

## Hourly Order Distribution for 2026-04-21

```text
hour_bucket            orders  finished  failed
2026-04-21 00:00:00    91      91        0
2026-04-21 01:00:00    104     90        14
2026-04-21 02:00:00    92      88        4
2026-04-21 03:00:00    78      74        4
2026-04-21 04:00:00    120     103       17
2026-04-21 05:00:00    402     60        342
2026-04-21 06:00:00    423     64        359
2026-04-21 07:00:00    89      69        20
2026-04-21 08:00:00    78      70        8
2026-04-21 09:00:00    37      33        4
2026-04-21 10:00:00    60      51        9
2026-04-21 11:00:00    130     110       20
2026-04-21 12:00:00    101     93        8
2026-04-21 13:00:00    50      41        9
2026-04-21 14:00:00    19      7         11
```

Observations:

- The severe degradation window is `05:00` to `06:59`.
- Failures spike sharply during the same high-load window.

## Order Type Breakdown for 2026-04-21

```text
type    orders  finished  failed  avg_total_seconds
-       946     886       60      895
Charge  743     77        665     140
Park    185     81        104     129
```

Observations:

- `Charge` orders are the dominant failure source.
- `Park` orders also fail frequently.
- Business/transport-like orders with `type='-'` complete much more often, but still take longer on average.

## Orders by Vehicle for 2026-04-21

```text
processing_vehicle  orders  finished  failed  avg_total_seconds
B300_2_4            131     117       13      748
B300_2_16           131     117       14      862
B300_2_18           129     107       22      930
B300_1_2            128     110       18      662
B300_1_1            114     106       8       802
B300_1_5            114     100       14      931
B300_1_3            110     92        18      612
B300_2_1            105     93        12      588
B300_2_17           100     76        24      817
B300_1_4            98      93        5       760
B300_2_9            41      33        8       950
```

Observations:

- All `11` vehicles were active.
- `B300_2_17`, `B300_2_18`, and `B300_2_9` show relatively high fail pressure and/or long cycle time.

## Vehicle State Transitions for 2026-04-21

Top transitions from `vehicle_history`:

```text
state        previous_state  transitions
EXECUTING    IDLE            6308
IDLE         EXECUTING       6204
ERROR        ERROR           819
ERROR        EXECUTING       225
EXECUTING    ERROR           194
IDLE         ERROR           115
ERROR        IDLE            98
CHARGING     EXECUTING       91
IDLE         UNKNOWN         75
IDLE         CHARGING        57
UNKNOWN      IDLE            46
UNAVAILABLE  IDLE            38
IDLE         UNAVAILABLE     36
```

Observations:

- There is a large amount of repeated `ERROR` state activity.
- This supports the hypothesis that many task failures were caused by vehicle-side issues, not only order logic.

## Vehicle Errors for 2026-04-21

Top records from `vehicle_error_history`:

```text
vehicle_id  error_code             errors  total_error_ms
9           E_STOP                 78      988387
9           ERROR                  78      1782
4           E_STOP                 34      92769
7           E_STOP                 31      1322538
7           ERROR                  29      795
4           ERROR                  27      297
6           E_STOP                 26      259144
33          E_STOP                 25      473547
3           E_STOP                 25      238729
8           E_STOP                 23      443196
32          E_STOP                 22      332791
6           ERROR                  20      281
8           ERROR                  19      394
33          ERROR                  19      96
3           ERROR                  18      120
5           E_STOP                 15      167020
12          E_STOP                 15      97813
12          ERROR                  15      1271
9           adapterLostNavigation  14      548656
2           E_STOP                 14      262121
```

Observations:

- `E_STOP` is the most significant repeated error on this day.
- `adapterLostNavigation` also appears and is likely operationally relevant.
- The fail spike is strongly correlated with vehicle-side interruption/error behavior.

## Sample Failed Orders for 2026-04-21

Example failed orders show:

- many `Park-...` orders failing
- many `Recharge-...` orders failing
- failed orders usually have `vehicle_assigned_time`
- `finished_at` is empty for failed rows

This means failure is happening after assignment, not before dispatch.

## Hot Runtime Positions from Vehicle History

Top positions from `vehicle_history.position`:

```text
position  logs
0021      344
2026      310
UNKNOWN   287
2036      262
2037      257
2038      248
0020      240
2034      227
2035      217
2025      212
2032      185
2039      144
0011      138
0124      132
0019      124
0018      118
2040      117
0123      114
0122      111
0125      101
```

Error-heavy positions:

```text
position  state        logs
UNKNOWN   ERROR        116
2519      ERROR        37
2070      ERROR        31
UNKNOWN   UNKNOWN      30
0014      ERROR        25
UNKNOWN   UNAVAILABLE  24
0021      ERROR        20
0758      ERROR        19
0038      ERROR        17
0113      ERROR        16
```

Observations:

- `UNKNOWN` is itself a hotspot and also an error hotspot.
- `0021` appears both as a general hotspot and as an error-related position.
- These runtime position codes are likely useful for bottleneck detection.

## Important Limitation: No Topology Master Data in This DB

Current row counts:

```text
table_name             rows
point                  0
path                   0
route                  0
vehicle_history        50994
vehicle_error_history  2597
transport_order        6294
```

Attempts to map `vehicle_history.position` to:

- `point.name`
- `point.rfid_code`
- `route.pointsrcname`
- `route.pointdestname`

all returned no matches because the topology tables are empty in this customer DB.

Implications:

- We can identify hot runtime position codes such as `0021`, `2026`, `2036`, `2037`.
- We cannot yet map them to physical node names, coordinates, or route topology from this DB alone.
- Static bottleneck inference from `point/path/route` is blocked until topology is populated or obtained from another source.

## What Can Be Answered Reliably Right Now

- Number of active AGVs
- Number of transport orders per day/hour
- Success/fail rate by day/hour
- Average assign time and completion time
- Task distribution by type
- Task distribution by vehicle
- Vehicle error frequency and duration
- Hot runtime positions from `vehicle_history`

## What Still Needs More Data or Mapping

- Physical node/lane bottleneck names
- Static route chokepoints from topology
- Manual intervention rate
- Priority-change rate
- Explicit deadlock/conflict event counts
- Real-time vs batch arrival classification
