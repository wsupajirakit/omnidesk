#!/usr/bin/env bash
# =============================================================================
# cf-firewall-sync.sh — append Cloudflare IP ranges (v4 + v6) to a Vultr firewall
#
# FLOW
#   1. List Firewall Groups from Vultr, match the one whose description == GROUP
#      (default "dev") and take its id — no id is ever hard-coded here.
#   2. Back up every existing rule of that group to a timestamped JSON file.
#   3. Fetch Cloudflare's published ranges: /ips-v4 (IPv4) and /ips-v6 (IPv6).
#   4. Add each range that is NOT already a rule on that port, as ip_type v4/v6.
#
# WHAT IT NEVER DOES
#   · never deletes, edits or reorders an existing rule — ADD-ONLY (ห้ามลบของเดิม)
#   · never removes the 0.0.0.0/0 rules — you do that by hand in the Vultr panel
#     AFTER verifying the Cloudflare rules work (see "AFTER RUNNING")
#   · never writes anything without --apply (dry-run is the default)
#
# IDEMPOTENT
#   A range already present on the same port (whoever added it) is skipped, so
#   re-running is a no-op. Safe to run again whenever Cloudflare adds a range.
#
# WHY (docs/migrate-stack.md — origin protection)
#   80/443 accept 0.0.0.0/0 today, so anyone can flood/probe the origin IP and
#   bypass Cloudflare. Allowing only Cloudflare at the network layer drops those
#   packets before Traefik sees them — something the app-layer proxy-gate cannot
#   do, because by then the connection is already accepted.
#
# USAGE
#   export VULTR_API_KEY=xxxxxxxx           # https://my.vultr.com/settings/#settingsapi
#   ./cf-firewall-sync.sh                   # dry-run: list what WOULD be added
#   ./cf-firewall-sync.sh --apply           # add the missing rules
#   ./cf-firewall-sync.sh --apply --ports 443
#   ./cf-firewall-sync.sh --apply --no-v6   # IPv4 only
#   ./cf-firewall-sync.sh --apply --only-v6 # IPv6 only (เติมส่วนที่ขาด ไม่แตะ v4)
#   ./cf-firewall-sync.sh --group other --apply
#
# AFTER RUNNING (manual — the script stops here on purpose)
#   1. Check the site through Cloudflare: dashboard, LINE webhook, WebSocket.
#   2. Only then delete the `0.0.0.0/0` (and `::/0`) rules for 80/443 in the
#      Vultr panel. Until you do, nothing is actually restricted.
#   3. Keep SSH (22) open — locking yourself out is the one unrecoverable move.
#
# revert: rules added here carry the note "cf-auto cloudflare" — delete those in
#         the panel, or compare against the backup JSON printed at run start.
#
# ── THE THREE FILES HERE — read as one set, not one at a time ────────────────
#   README.md                START HERE. API key setup, every flag, the manual
#                            steps this script stops before, rollback, verify.
#   cf-firewall-sync.sh      ← YOU ARE HERE. ADD-ONLY: puts Cloudflare ranges in.
#   cf-firewall-restore.sh   THE UNDO. Puts the group back to a `.before.json`
#                            snapshot — `--list` shows what can be restored,
#                            `--strict` also deletes what the snapshot lacks.
#   backup/*.json            before/after snapshots. BOTH scripts write them,
#                            every run, dry-run included.
#   ⇒ ถ้าเผลอ apply แล้วอยากถอย: ใช้ cf-firewall-restore.sh อย่าไปไล่ลบมือในแผง
# =============================================================================
set -euo pipefail

# ── config ───────────────────────────────────────────────────────────────────
GROUP_NAME="${GROUP_NAME:-dev}"          # firewall group *description* in Vultr
PORTS="${PORTS:-80,443}"
NOTE="cf-auto cloudflare"                # tag on every rule this script adds
CF_V4_URL="https://www.cloudflare.com/ips-v4"
CF_V6_URL="https://www.cloudflare.com/ips-v6"
API="https://api.vultr.com/v2"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_DIR="${BACKUP_DIR:-$SCRIPT_DIR/backup}"   # เก็บ backup ข้างสคริปต์ (โฟลเดอร์นี้ถูก gitignore ทั้งก้อน)

APPLY=0; WITH_V4=1; WITH_V6=1
while [ $# -gt 0 ]; do
  case "$1" in
    --apply)  APPLY=1 ;;
    --no-v6)  WITH_V6=0 ;;
    # v6 อย่างเดียว — ใช้ตอน v4 ครบแล้ว/โควตา rule เหลือน้อย (ไม่ยิง API ฝั่ง v4 เลย)
    --only-v6) WITH_V4=0; WITH_V6=1 ;;
    --group)  GROUP_NAME="${2:?--group ต้องตามด้วยชื่อ}"; shift ;;
    --ports)  PORTS="${2:?--ports ต้องตามด้วยพอร์ต}"; shift ;;
    -h|--help) sed -n '2,59p' "$0"; exit 0 ;;
    *) echo "unknown arg: $1 (ดู --help)" >&2; exit 2 ;;
  esac
  shift
done

need() { command -v "$1" >/dev/null || { echo "✗ ต้องมี '$1' (brew install $1)" >&2; exit 1; }; }
need curl; need jq

# ── API key: .env ข้างสคริปต์ (gitignored) หรือ env var ที่ export ไว้ ────────
#    ไฟล์ .env ถูก .gitignore คุมอยู่แล้ว — key จึงไม่มีวันติดขึ้น git
#    env var ที่ export มาก่อนชนะเสมอ (ไม่ทับของที่ตั้งใจ override)
ENV_FILE="$SCRIPT_DIR/.env"
if [ -z "${VULTR_API_KEY:-}" ] && [ -f "$ENV_FILE" ]; then
  # shellcheck disable=SC1090
  set -a; . "$ENV_FILE"; set +a
  echo "   env file : .env (โหลดแล้ว)"
fi
[ -n "${VULTR_API_KEY:-}" ] || {
  echo "✗ ไม่พบ VULTR_API_KEY" >&2
  echo "  ทางเลือก 1: ใส่ในไฟล์ .env ข้างสคริปต์  →  export VULTR_API_KEY=xxxx" >&2
  echo "  ทางเลือก 2: export VULTR_API_KEY=xxxx  ใน shell ก่อนรัน" >&2
  exit 1
}

AUTH=(-H "Authorization: Bearer ${VULTR_API_KEY}" -H "Content-Type: application/json")
api_get()  { curl -fsS "${AUTH[@]}" "$API$1"; }
api_post() { curl -fsS "${AUTH[@]}" -X POST "$API$1" --data "$2"; }

MODE=$([ $APPLY -eq 1 ] && echo APPLY || echo DRY-RUN)
echo "══ cf-firewall-sync · group='${GROUP_NAME}' · ports=${PORTS} · v6=$([ $WITH_V6 -eq 1 ] && echo on || echo off) · ${MODE}"

# ── 1. List Firewall Groups → หา id จากชื่อ (description == GROUP_NAME) ──────
groups_json="$(api_get /firewalls)"
GROUP_ID="$(echo "$groups_json" | jq -r --arg n "$GROUP_NAME" \
  '.firewall_groups[] | select(.description == $n) | .id' | head -1)"

if [ -z "$GROUP_ID" ] || [ "$GROUP_ID" = "null" ]; then
  echo "✗ ไม่พบ firewall group ชื่อ '${GROUP_NAME}' · ที่มีในบัญชี:" >&2
  echo "$groups_json" | jq -r '.firewall_groups[] |
    "   • \(.description)   id=\(.id)  rules=\(.rule_count)  instances=\(.instance_count)"' >&2
  exit 1
fi
echo "   group id : $GROUP_ID"

# ── 2. BACKUP + BEFORE snapshot — ทำทุกโหมด รวม dry-run ─────────────────────
#    เก็บสถานะ "ก่อน" ไว้เสมอ แม้จะไม่ได้เขียนอะไร: ไฟล์นี้คือหลักฐานว่า ณ เวลานั้น
#    firewall มีอะไรอยู่บ้าง และเป็นตัวเทียบตอนจบรอบ (AFTER) กับตอน rollback
mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_FILE="$BACKUP_DIR/${GROUP_NAME}-${STAMP}.before.json"
rules_json="$(api_get "/firewalls/$GROUP_ID/rules")"
echo "$rules_json" > "$BACKUP_FILE"
BEFORE_COUNT="$(echo "$rules_json" | jq '.firewall_rules | length')"
echo "   backup   : backup/$(basename "$BACKUP_FILE")  (${BEFORE_COUNT} rules)"

echo ""
echo "── BEFORE — rule ที่มีอยู่ตอนนี้ ──────────────────────────────────────────"
echo "$rules_json" | jq -r '.firewall_rules[]
  | "   \(.action)  \(.ip_type)  \(.protocol)/\(.port)  \(.subnet)/\(.subnet_size)  \(.notes // "")"'
echo "──────────────────────────────────────────────────────────────────────────"
echo ""

# ── 3. ดึง Cloudflare ranges (v4 + v6) ───────────────────────────────────────
cf_v4=""
if [ $WITH_V4 -eq 1 ]; then
  cf_v4="$(curl -fsS "$CF_V4_URL" | grep -E '^[0-9]' || true)"
  [ -n "$cf_v4" ] || { echo "✗ ดึง Cloudflare IPv4 ไม่ได้ — ยกเลิก (ไม่แตะ firewall)" >&2; exit 1; }
fi
cf_v6=""
if [ $WITH_V6 -eq 1 ]; then
  cf_v6="$(curl -fsS "$CF_V6_URL" | grep -E '^[0-9a-fA-F]*:' || true)"
  [ -n "$cf_v6" ] || echo "   ⚠ ดึง IPv6 ไม่ได้ — ทำเฉพาะ v4 รอบนี้"
fi
echo "   cf ranges: v4=$(echo "$cf_v4" | grep -c . || true)  v6=$(echo "${cf_v6:-}" | grep -c . || true)"

# ── 4. เพิ่มเฉพาะ range ที่ยังไม่มีบนพอร์ตนั้น (ของเดิมไม่ถูกแตะ) ───────────
added=0; skipped=0
IFS=',' read -r -a PORT_LIST <<< "$PORTS"

# ⚠️ อย่าเรียกฟังก์ชันนี้ผ่าน pipe (`echo ... | add_ranges`) — bash จะรันใน subshell
#    แล้ว added/skipped ที่นับข้างในจะหายไปตอนออก (สรุปขึ้น 0 ทั้งที่เพิ่มจริง)
#    ใช้ here-string แทน: `add_ranges v4 <<< "$cf_v4"` → รันใน shell เดิม ตัวนับถูกต้อง
add_ranges() {           # $1 = ip_type (v4|v6) · stdin = ranges
  local ip_type="$1" cidr subnet size exists payload port
  while read -r cidr; do
    [ -n "$cidr" ] || continue
    subnet="${cidr%/*}"; size="${cidr#*/}"
    for port in "${PORT_LIST[@]}"; do
      port="$(echo "$port" | tr -d ' ')"

      # มีอยู่แล้วไหม — เทียบ port + subnet + size (ไม่สนว่าใครเพิ่ม)
      exists="$(echo "$rules_json" | jq -r --arg p "$port" --arg s "$subnet" --argjson z "$size" '
        [ .firewall_rules[]
          | select(((.port|tostring) == $p) and (.subnet == $s) and (.subnet_size == $z))
        ] | length')"

      if [ "${exists:-0}" != "0" ]; then
        skipped=$((skipped+1)); continue
      fi

      payload="$(jq -nc --arg t "$ip_type" --arg p "$port" --arg s "$subnet" \
                        --argjson z "$size" --arg n "$NOTE" \
        '{ip_type:$t, protocol:"tcp", port:$p, subnet:$s, subnet_size:$z, notes:$n}')"

      if [ $APPLY -eq 1 ]; then
        api_post "/firewalls/$GROUP_ID/rules" "$payload" >/dev/null
        echo "   + added     $ip_type tcp/$port  $cidr"
      else
        echo "   ~ would add $ip_type tcp/$port  $cidr"
      fi
      added=$((added+1))
    done
  done
}

[ -n "$cf_v4" ] && add_ranges v4 <<< "$cf_v4"
[ -n "$cf_v6" ] && add_ranges v6 <<< "$cf_v6"

# ── 5. AFTER snapshot — ดึงสถานะจริงอีกรอบแล้วเก็บไฟล์ (ทำทุกโหมด) ──────────
#    dry-run ก็เก็บ: after ต้องเท่ากับ before เป๊ะ = หลักฐานว่า dry-run ไม่แตะอะไรจริง
AFTER_FILE="$BACKUP_DIR/${GROUP_NAME}-${STAMP}.after.json"
after_json="$(api_get "/firewalls/$GROUP_ID/rules")"
echo "$after_json" > "$AFTER_FILE"
AFTER_COUNT="$(echo "$after_json" | jq '.firewall_rules | length')"

echo ""
echo "── AFTER — rule ทั้งหมด ณ ตอนนี้ ─────────────────────────────────────────"
echo "$after_json" | jq -r '.firewall_rules[]
  | "   \(.action)  \(.ip_type)  \(.protocol)/\(.port)  \(.subnet)/\(.subnet_size)  \(.notes // "")"'
echo "──────────────────────────────────────────────────────────────────────────"

echo ""
echo "══ BEFORE → AFTER ═══════════════════════════════════════════════════════"
printf "   rules   : %s → %s   (%+d)\n" "$BEFORE_COUNT" "$AFTER_COUNT" "$((AFTER_COUNT - BEFORE_COUNT))"
printf "   วางแผน  : เพิ่ม %s · ข้าม(มีอยู่แล้ว) %s\n" "$added" "$skipped"
echo "   backup  : backup/$(basename "$BACKUP_FILE")"
echo "             backup/$(basename "$AFTER_FILE")"

# rule ที่หายไป — ต้องเป็น 0 เสมอ เพราะสคริปต์ไม่มีทางลบอะไร (กันพลาดเงียบ)
LOST="$(jq -n --slurpfile b "$BACKUP_FILE" --slurpfile a "$AFTER_FILE" '
  ($b[0].firewall_rules // []) as $B | ($a[0].firewall_rules // []) as $A
  | [ $B[] | select( . as $r | ($A | map(select(.id == $r.id)) | length) == 0 ) ] | length')"
if [ "${LOST:-0}" != "0" ]; then
  echo "   🔴 rule เดิมหายไป ${LOST} ตัว — ไม่ควรเกิดขึ้น! กู้จาก backup/$(basename "$BACKUP_FILE") ทันที"
else
  echo "   ✔ rule เดิมอยู่ครบทุกตัว (ไม่มีอะไรถูกลบ/แก้)"
fi

echo ""
if [ $APPLY -eq 0 ]; then
  if [ "$BEFORE_COUNT" = "$AFTER_COUNT" ]; then
    echo "   DRY-RUN — ยืนยัน: before == after ไม่มีอะไรถูกเขียนจริง ✔"
  else
    echo "   ⚠ DRY-RUN แต่จำนวน rule เปลี่ยน — มีคนอื่นแก้ firewall พร้อมกันอยู่?"
  fi
  echo "   รันซ้ำด้วย --apply เพื่อเพิ่มจริง (${added} rule)"
else
  echo "   ✔ เพิ่มแล้ว — เช็คเว็บ/LINE/WS ให้ผ่านก่อน แล้วค่อยลบ 0.0.0.0/0 ของ 80/443 ในหน้า Vultr เอง"
  echo "   rollback: ลบ rule ที่ note = '${NOTE}' · หรือเทียบกับ backup/$(basename "$BACKUP_FILE")"
fi
