#!/usr/bin/env bash
# E3 planner-mode sweep.
#
# Each arm needs its own kernel process because the solver reads its window and
# anytime settings once, at class-load. The arm therefore restarts the kernel
# with -Pfmsflags, collects the kernel's solve telemetry for the duration of the
# arm, and runs the same seeded matrix as every other arm.
#
# Battery is levelled between arms (never inside a cell) so a late arm does not
# start on a fleet the earlier arms drained.
set -u

KERNEL_LOG="/d/WES/opentcs-integration-FMS/opentcs-FMS-kernel/build/install/opentcs-FMS-kernel/log/opentcs-kernel.0.log"
OUT="/d/WES/paper/stage7-icacr/data/e3"
PUB="C:/Program Files/mosquitto/mosquitto_pub.exe"
mkdir -p "$OUT"

level_batteries() {
  for i in $(seq -w 1 15); do
    "$PUB" -h localhost -t "aubotagv/v2/AUBOT/V$i/instantActions" -m \
      "{\"headerId\":1,\"timestamp\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"version\":\"2.0.0\",\"manufacturer\":\"AUBOT\",\"serialNumber\":\"V$i\",\"actions\":[{\"actionType\":\"setPinLevel\",\"actionId\":\"e3-$i-$RANDOM\",\"blockingType\":\"NONE\",\"actionParameters\":[{\"key\":\"pinLevel\",\"value\":90}]}]}" \
      >/dev/null 2>&1
  done
  sleep 5
}

wait_for_fleet() {
  local deadline=$((SECONDS + 240))
  while [ $SECONDS -lt $deadline ]; do
    local n
    n=$(curl -s -m 5 http://localhost:55200/v1/vehicles | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const v=JSON.parse(d).filter(x=>/^Vehicle-\d+\$/.test(x.name));console.log(v.filter(x=>x.integrationLevel==='TO_BE_UTILIZED'&&x.currentPosition&&(x.energyLevel??0)>10).length)}catch(e){console.log(0)}})")
    [ "$n" = "15" ] && return 0
    # a vehicle whose adapter came up without a position stays invisible to the
    # kernel until the adapter is cycled; the simulator is already reporting it
    for v in $(seq -w 1 15); do
      curl -s -m 5 http://localhost:55200/v1/vehicles/Vehicle-00$v | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const x=JSON.parse(d);if(x.integrationLevel==='TO_BE_UTILIZED'&&!x.currentPosition)console.log(x.name)}catch(e){}})"
    done | while read -r name; do
      curl -s -o /dev/null -m 8 -X PUT "http://localhost:55200/v1/vehicles/$name/commAdapter/enabled?newValue=false"
      sleep 1
      curl -s -o /dev/null -m 8 -X PUT "http://localhost:55200/v1/vehicles/$name/commAdapter/enabled?newValue=true"
      echo "  recycled adapter for $name"
    done
    sleep 15
  done
  return 1
}

run_arm() {
  local name="$1" flags="$2"
  echo "===== E3 arm $name ${flags:-(deployed defaults)} ====="

  level_batteries
  if [ -n "$flags" ]; then
    node scripts/restart-kernel.js --condition S1 --fleet 15 --flags "$flags" || true
  else
    node scripts/restart-kernel.js --condition S1 --fleet 15 || true
  fi

  if ! wait_for_fleet; then
    echo "HALT arm $name: fleet never reached 15"
    return 1
  fi

  tail -F -n 0 "$KERNEL_LOG" 2>/dev/null \
    | grep --line-buffered -E '\[MAPF e2e\]|\[MAPF solve\]' > "$OUT/$name.log" &
  local collector=$!

  node scripts/run-matrix.js --matrix "scripts/matrices/e3-$name.json"
  local rc=$?

  kill "$collector" 2>/dev/null
  echo "arm $name finished rc=$rc, $(wc -l < "$OUT/$name.log") telemetry lines"
  return 0
}

run_arm w5    "fms.mapf.window=5"
run_arm w10   ""
run_arm w20   "fms.mapf.window=20"
run_arm wfull "fms.mapf.window=0"
run_arm noany "fms.mapf.anytime=false"

echo "E3 SWEEP COMPLETE"
