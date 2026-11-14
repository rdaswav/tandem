#!/usr/bin/env bash
# Deploys the committed code to the NAS: checks it, sends it, builds the image
# there, replaces the container and waits for it to be healthy.
#
#   ./scripts/deploy.sh            do it
#   ./scripts/deploy.sh --dry-run  print every command, run nothing, touch nothing
#
# Settings, all optional, read from the environment when you run this:
#   TANDEM_TZ                 time zone for weeks and dates   (default Australia/Melbourne)
#   TANDEM_CHECKIN_START_DAY  0 for Sunday ... 6 for Saturday (default 0)
#   SERVER_OWNER              the name shown on the third welcome page as the
#                             person who looks after the server (default: the first person)
#
# The NAS is reached only as the ssh host alias "nas". No address is written here.
set -euo pipefail

cd "$(dirname "$0")/.."

usage() {
  sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'
}

DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    -h | --help) usage; exit 0 ;;
    *) echo "unknown option: $arg" >&2; usage >&2; exit 2 ;;
  esac
done

HOST=nas
REMOTE_DIR=/volume1/docker/tandem
DOCKER="sudo /usr/local/bin/docker"
NAME=tandem
PORT=8790

TZ_VALUE="${TANDEM_TZ:-Australia/Melbourne}"
START_DAY="${TANDEM_CHECKIN_START_DAY:-0}"
OWNER="${SERVER_OWNER:-}"

# Check the settings before they are put into a command that runs on the NAS.
[[ "$TZ_VALUE" =~ ^[A-Za-z0-9_/+-]+$ ]] || { echo "TANDEM_TZ is not a time zone name: $TZ_VALUE" >&2; exit 2; }
[[ "$START_DAY" =~ ^[0-6]$ ]] || { echo "TANDEM_CHECKIN_START_DAY must be 0 to 6: $START_DAY" >&2; exit 2; }
if [ -n "$OWNER" ] && ! [[ "$OWNER" =~ ^[[:alnum:]\ ._\'-]{1,40}$ ]]; then
  echo "SERVER_OWNER may use letters, digits, spaces and . _ ' - only, up to 40 characters" >&2
  exit 2
fi

quote() { printf '%q' "$1"; }

RUN_ENV="-e TZ=$(quote "$TZ_VALUE") -e CHECKIN_START_DAY=$(quote "$START_DAY")"
if [ -n "$OWNER" ]; then
  RUN_ENV="$RUN_ENV -e SERVER_OWNER=$(quote "$OWNER")"
fi

COMMIT="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"

SHIP_REMOTE="rm -rf $REMOTE_DIR/src && mkdir -p $REMOTE_DIR/src && tar xf - -C $REMOTE_DIR/src"
BUILD_REMOTE="cd $REMOTE_DIR/src && $DOCKER build --build-arg COMMIT=$COMMIT -t $NAME ."
REPLACE_REMOTE="($DOCKER stop $NAME || true) && ($DOCKER rm $NAME || true)"
RUN_REMOTE="$DOCKER run -d --name $NAME --restart unless-stopped -p $PORT:$PORT -v ${NAME}_data:/app/data $RUN_ENV $NAME"
HEALTH_REMOTE="for i in \$(seq 1 30); do s=\$($DOCKER inspect --format '{{.State.Health.Status}}' $NAME); [ \"\$s\" = healthy ] && exit 0; sleep 2; done; echo '$NAME did not become healthy' >&2; exit 1"

step() { printf '\n== %s\n' "$1"; }

# 1. The same gate every commit passes.
step "1. check the code"
if [ "$DRY_RUN" -eq 1 ]; then
  echo "+ ./scripts/verify.sh"
else
  ./scripts/verify.sh
fi

# 2. Only committed code is sent: what is in git, nothing else.
step "2. make sure everything is committed"
if [ -n "$(git status --porcelain)" ]; then
  if [ "$DRY_RUN" -eq 1 ]; then
    echo "note: there are uncommitted changes. A real deploy would refuse; it sends only what is committed."
  else
    echo "refusing: there are uncommitted changes. Commit them, then run this again." >&2
    exit 1
  fi
else
  echo "clean: deploying commit $COMMIT"
fi

# 3. Send the committed files. scp is turned off on this NAS, so tar goes over ssh.
step "3. send the files to the NAS"
if [ "$DRY_RUN" -eq 1 ]; then
  echo "+ git archive HEAD | ssh $HOST '$SHIP_REMOTE'"
else
  git archive HEAD | ssh "$HOST" "$SHIP_REMOTE"
fi

# 4. Build the image on the NAS.
step "4. build the image"
if [ "$DRY_RUN" -eq 1 ]; then
  echo "+ ssh $HOST '$BUILD_REMOTE'"
else
  ssh "$HOST" "$BUILD_REMOTE"
fi

# 5. Replace the container. The volume ${NAME}_data is left alone, so the data stays.
step "5. replace the container (the data volume is kept)"
if [ "$DRY_RUN" -eq 1 ]; then
  echo "+ ssh $HOST '$REPLACE_REMOTE'"
  echo "+ ssh $HOST '$RUN_REMOTE'"
else
  ssh "$HOST" "$REPLACE_REMOTE"
  ssh "$HOST" "$RUN_REMOTE"
fi

# 6. Wait until it says it is healthy.
step "6. wait until it is healthy"
if [ "$DRY_RUN" -eq 1 ]; then
  echo "+ ssh $HOST '$HEALTH_REMOTE'"
  printf '\n(dry run: nothing was run, nothing was sent, no network was used)\n'
else
  ssh "$HOST" "$HEALTH_REMOTE"
  printf '\nDeployed commit %s. Open http://<your nas address>:%s on the home Wi-Fi.\n' "$COMMIT" "$PORT"
fi
