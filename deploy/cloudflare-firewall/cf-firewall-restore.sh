#!/usr/bin/env bash
# =============================================================================
# cf-firewall-restore.sh — put a Vultr firewall group back to a backup snapshot
#
# WHAT IT DOES
#   Compares the group's CURRENT rules against a `.before.json` snapshot taken by
#   cf-firewall-sync.sh, then:
#     · re-CREATES rules that exist in the snapshot but are missing now (กู้ที่หาย)
#     · optionally DELETES rules that exist now but not in the snapshot (--strict)
#
# TWO MODES — pick on purpose
#   default   ADD-BACK ONLY. Missing rules are recreated; anything extra is left
#             alone. Safe: cannot lock you out, cannot remove a rule you meant to
#             keep. This is what you want after "ลบ rule ผิดไป".
#   --strict  EXACT RESTORE. Also deletes rules that are not in the snapshot, so
#             the group ends up byte-identical to the backup. Use when you want
#             to undo an --apply completely.
#
# SAFETY
#   · DRY-RUN by default — nothing is written until you pass --apply
#   · takes its OWN before/after backup every run (even dry-run)
#   · refuses to delete SSH (port 22) rules in --strict — locking yourself out of
#     the server is the one mistake with no undo
#   · rule ids are never reused by the API, so a "restored" rule gets a new id;
#     matching is done on (ip_type, protocol, port, subnet, subnet_size), which is
#     what actually decides who can reach the server
#
# USAGE
#   ./cf-firewall-restore.sh                          # dry-run vs newest .before.json
#   ./cf-firewall-restore.sh --apply                  # add back what's missing
#   ./cf-firewall-restore.sh --apply --strict         # exact restore (also deletes extras)
#   ./cf-firewall-restore.sh --file backup/dev-20260814-141916.before.json --apply
#   ./cf-firewall-restore.sh --list                   # show snapshots you can restore from
#
# ── THE THREE FILES HERE — read as one set, not one at a time ────────────────
#   README.md                START HERE. API key setup, every flag, the manual
#                            steps to take after an apply, rollback, verify.
#   cf-firewall-sync.sh      THE FORWARD MOVE. ADD-ONLY: puts Cloudflare ranges
#                            in; it is what writes the snapshots this file reads.
#   cf-firewall-restore.sh   ← YOU ARE HERE. The undo for the above.
#   backup/*.json            before/after snapshots. BOTH scripts write them,
#                            every run, dry-run included. `--list` reads this dir.
#   ⇒ ไฟล์นี้กู้ได้เฉพาะสิ่งที่ sync เคย snapshot ไว้ · ไม่มี backup = กู้ไม่ได้
# =============================================================================
set -euo pipefail

GROUP_NAME="${GROUP_NAME:-dev}"
API="https://api.vultr.com/v2"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_DIR="${BACKUP_DIR:-$SCRIPT_DIR/backup}"

APPLY=0; STRICT=0; SNAP=""; LIST=0
while [ $# -gt 0 ]; do
  case "$1" in
    --apply)  APPLY=1 ;;
    --strict) STRICT=1 ;;
    --file)   SNAP="${2:?--file ต้องตามด้วย path ของ .before.json}"; shift ;;
    --group)  GROUP_NAME="${2:?--group ต้องตามด้วยชื่อ}"; shift ;;
    --list)   LIST=1 ;;
    -h|--help) sed -n '2,44p' "$0"; exit 0 ;;
    *) echo "unknown arg: $1 (ดู --help)" >&2; exit 2 ;;
  esac
  shift
done

need() { command -v "$1" >/dev/null || { echo "✗ ต้องมี '$1' (brew install $1)" >&2; exit 1; }; }
need curl; need jq

if [ $LIST -eq 1 ]; then
  echo "── snapshot ที่กู้คืนได้ (ใหม่สุดอยู่บน) ──"
  ls -t "$BACKUP_DIR"/*.before.json 2>/dev/null | while read -r f; do
    printf "   %-42s  %s rules\n" "backup/$(basename "$f")" "$(jq '.firewall_rules|length' "$f")"
  done || echo "   (ยังไม่มี backup — รัน cf-firewall-sync.sh ก่อน)"
  exit 0
fi

ENV_FILE="$SCRIPT_DIR/.env"
if [ -z "${VULTR_API_KEY:-}" ] && [ -f "$ENV_FILE" ]; then
  set -a; . "$ENV_FILE"; set +a
  echo "   env file : .env (โหลดแล้ว)"
fi
[ -n "${VULTR_API_KEY:-}" ] || { echo "✗ ไม่พบ VULTR_API_KEY (ใส่ใน .env ข้างสคริปต์)" >&2; exit 1; }

AUTH=(-H "Authorization: Bearer ${VULTR_API_KEY}" -H "Content-Type: application/json")
api_get()    { curl -fsS "${AUTH[@]}" "$API$1"; }
api_post()   { curl -fsS "${AUTH[@]}" -X POST "$API$1" --data "$2"; }
api_delete() { curl -fsS "${AUTH[@]}" -X DELETE "$API$1"; }

# ── เลือก snapshot ───────────────────────────────────────────────────────────
if [ -z "$SNAP" ]; then
  SNAP="$(ls -t "$BACKUP_DIR"/*.before.json 2>/dev/null | head -1 || true)"
fi
[ -n "$SNAP" ] && [ -f "$SNAP" ] || {
  echo "✗ ไม่พบไฟล์ snapshot — ดูรายการด้วย: ./cf-firewall-restore.sh --list" >&2; exit 1; }
jq -e '.firewall_rules' "$SNAP" >/dev/null 2>&1 || { echo "✗ ไฟล์ไม่ใช่ snapshot ที่ถูกต้อง: backup/$(basename "$SNAP")" >&2; exit 1; }

MODE=$([ $APPLY -eq 1 ] && echo APPLY || echo DRY-RUN)
KIND=$([ $STRICT -eq 1 ] && echo "STRICT (add back + ลบส่วนเกิน)" || echo "ADD-BACK ONLY (ไม่ลบอะไร)")
echo "══ cf-firewall-restore · group='${GROUP_NAME}' · ${MODE} · ${KIND}"
echo "   snapshot : backup/$(basename "$SNAP")  ($(jq '.firewall_rules|length' "$SNAP") rules)"

# ── หา group id จากชื่อ ──────────────────────────────────────────────────────
groups_json="$(api_get /firewalls)"
GROUP_ID="$(echo "$groups_json" | jq -r --arg n "$GROUP_NAME" \
  '.firewall_groups[] | select(.description == $n) | .id' | head -1)"
[ -n "$GROUP_ID" ] && [ "$GROUP_ID" != "null" ] || {
  echo "✗ ไม่พบ firewall group ชื่อ '${GROUP_NAME}'" >&2; exit 1; }
echo "   group id : $GROUP_ID"

# ── backup ของรอบ restore เอง (ทำทุกโหมด) ───────────────────────────────────
mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
PRE="$BACKUP_DIR/${GROUP_NAME}-${STAMP}.restore-before.json"
cur_json="$(api_get "/firewalls/$GROUP_ID/rules")"
echo "$cur_json" > "$PRE"
echo "   backup   : backup/$(basename "$PRE")  ($(echo "$cur_json" | jq '.firewall_rules|length') rules)"

key='"\(.ip_type)|\(.protocol)|\(.port)|\(.subnet)/\(.subnet_size)"'

# ── ① rule ที่หายไป (มีใน snapshot แต่ไม่มีตอนนี้) → สร้างคืน ───────────────
missing="$(jq -n --slurpfile s "$SNAP" --argjson c "$cur_json" --arg k "$key" '
  ($s[0].firewall_rules // []) as $S | ($c.firewall_rules // []) as $C
  | [ $S[] | select( . as $r
      | ($C | map(select(.ip_type==$r.ip_type and .protocol==$r.protocol
                     and (.port|tostring)==($r.port|tostring)
                     and .subnet==$r.subnet and .subnet_size==$r.subnet_size)) | length) == 0 ) ]')"
missing_n="$(echo "$missing" | jq 'length')"

# ── ② rule ส่วนเกิน (มีตอนนี้ แต่ไม่มีใน snapshot) → ลบเฉพาะ --strict ───────
extra="$(jq -n --slurpfile s "$SNAP" --argjson c "$cur_json" '
  ($s[0].firewall_rules // []) as $S | ($c.firewall_rules // []) as $C
  | [ $C[] | select( . as $r
      | ($S | map(select(.ip_type==$r.ip_type and .protocol==$r.protocol
                     and (.port|tostring)==($r.port|tostring)
                     and .subnet==$r.subnet and .subnet_size==$r.subnet_size)) | length) == 0 ) ]')"
extra_n="$(echo "$extra" | jq 'length')"

echo ""
echo "── ต่างกันอย่างไร ────────────────────────────────────────────────────────"
echo "   หายไปจาก snapshot (จะสร้างคืน) : $missing_n"
echo "$missing" | jq -r '.[] | "     + \(.ip_type) \(.protocol)/\(.port)  \(.subnet)/\(.subnet_size)  \(.notes // "")"'
echo "   เกินมาจาก snapshot            : $extra_n $([ $STRICT -eq 1 ] && echo '(จะลบ)' || echo '(ปล่อยไว้ — ใส่ --strict ถึงจะลบ)')"
echo "$extra" | jq -r '.[] | "     - \(.ip_type) \(.protocol)/\(.port)  \(.subnet)/\(.subnet_size)  \(.notes // "")"'
echo "──────────────────────────────────────────────────────────────────────────"
echo ""

restored=0; deleted=0; refused=0

# ── สร้างคืน ────────────────────────────────────────────────────────────────
while read -r rule; do
  [ -n "$rule" ] || continue
  payload="$(echo "$rule" | jq -c '{ip_type, protocol, subnet, subnet_size,
                                    port: (.port|tostring),
                                    notes: (.notes // "restored")}')"
  if [ $APPLY -eq 1 ]; then
    api_post "/firewalls/$GROUP_ID/rules" "$payload" >/dev/null
    echo "   ✔ restored $(echo "$rule" | jq -r '"\(.ip_type) \(.protocol)/\(.port) \(.subnet)/\(.subnet_size)"')"
  else
    echo "   ~ would restore $(echo "$rule" | jq -r '"\(.ip_type) \(.protocol)/\(.port) \(.subnet)/\(.subnet_size)"')"
  fi
  restored=$((restored+1))
done <<< "$(echo "$missing" | jq -c '.[]')"

# ── ลบส่วนเกิน (เฉพาะ --strict · ไม่แตะ SSH) ────────────────────────────────
if [ $STRICT -eq 1 ]; then
  while read -r rule; do
    [ -n "$rule" ] || continue
    rid="$(echo "$rule" | jq -r '.id')"
    rport="$(echo "$rule" | jq -r '.port|tostring')"
    if [ "$rport" = "22" ]; then
      echo "   ⚠ ข้าม (ไม่ลบ SSH/22 เด็ดขาด): $(echo "$rule" | jq -r '"\(.subnet)/\(.subnet_size)"')"
      refused=$((refused+1)); continue
    fi
    if [ $APPLY -eq 1 ]; then
      api_delete "/firewalls/$GROUP_ID/rules/$rid" >/dev/null
      echo "   ✖ deleted  $(echo "$rule" | jq -r '"\(.ip_type) \(.protocol)/\(.port) \(.subnet)/\(.subnet_size)"')"
    else
      echo "   ~ would delete $(echo "$rule" | jq -r '"\(.ip_type) \(.protocol)/\(.port) \(.subnet)/\(.subnet_size)"')"
    fi
    deleted=$((deleted+1))
  done <<< "$(echo "$extra" | jq -c '.[]')"
fi

# ── after snapshot + สรุป ───────────────────────────────────────────────────
POST="$BACKUP_DIR/${GROUP_NAME}-${STAMP}.restore-after.json"
after_json="$(api_get "/firewalls/$GROUP_ID/rules")"
echo "$after_json" > "$POST"

echo ""
echo "── AFTER ─────────────────────────────────────────────────────────────────"
echo "$after_json" | jq -r '.firewall_rules[]
  | "   \(.action)  \(.ip_type)  \(.protocol)/\(.port)  \(.subnet)/\(.subnet_size)  \(.notes // "")"'
echo "──────────────────────────────────────────────────────────────────────────"
echo ""
echo "══ สรุป: กู้คืน ${restored} · ลบ ${deleted} · ข้าม SSH ${refused}"
printf "   rules: %s → %s\n" "$(echo "$cur_json" | jq '.firewall_rules|length')" "$(echo "$after_json" | jq '.firewall_rules|length')"
echo "   backup: backup/$(basename "$PRE")  ·  backup/$(basename "$POST")"
if [ $APPLY -eq 0 ]; then
  echo "   DRY-RUN — ยังไม่เขียนอะไร · เติม --apply เพื่อกู้จริง"
else
  echo "   ✔ กู้คืนแล้ว — เช็คเว็บ/LINE/WS อีกรอบให้ชัวร์"
fi
