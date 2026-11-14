# Running Tandem on the NAS

Tandem runs as one Docker container on the home NAS, with its data in a Docker volume. You open it from a phone on the home Wi-Fi and add it to the home screen. Nothing here needs the internet.

These notes use the ssh host alias `nas` and the docker command as this NAS needs it (`sudo /usr/local/bin/docker`). No address is written down anywhere in the project: where one is needed, this says `<your nas address>`.

## Before the first deploy

1. Check that port 8790 is free:

   ```bash
   ssh nas "sudo /usr/local/bin/docker ps --format '{{.Names}} {{.Ports}}'"
   ```

   If something already uses 8790, pick another port and change `PORT` in `scripts/deploy.sh` and `EXPOSE` and the health check in the `Dockerfile` to match.
2. Make sure `ssh nas` works from this Mac without a password.
3. The container is called `tandem` and the volume `tandem_data`. Do not reuse those names for anything else.

## First deploy

From the project folder, with everything committed:

```bash
./scripts/deploy.sh --dry-run   # prints every command and runs nothing
./scripts/deploy.sh             # does it
```

The script runs the tests, sends only what is committed (tar over ssh, because scp is turned off on this NAS), builds the image on the NAS, replaces the container and waits until it reports healthy. It refuses to run if there are uncommitted changes. The data volume is never touched by a redeploy.

Settings are read from the environment when you run the script, and all are optional:

| Setting | What it does | Default |
|---|---|---|
| `TANDEM_TZ` | Time zone used for weeks and dates | `Australia/Melbourne` |
| `TANDEM_CHECKIN_START_DAY` | Day a check-in week starts, 0 for Sunday to 6 for Saturday | `0` |
| `SERVER_OWNER` | The name shown on the third welcome page as the person who looks after the server | the first person |

For example: `SERVER_OWNER="Ada" TANDEM_CHECKIN_START_DAY=1 ./scripts/deploy.sh`. The name is passed to the container when you deploy and is never written into a file in the project.

Check it is up from a phone on the home Wi-Fi: open `http://<your nas address>:8790/healthz`. It should show `{"ok":true}`.

## Make the two people

The app has no sign up. Exactly two people exist, and you make them once, on the NAS:

```bash
ssh nas "sudo /usr/local/bin/docker exec tandem node scripts/create-users.mjs '<first name>' '<second name>'"
```

It prints two lines, one setup path for each person, in the order you gave the names. Each looks like `/setup/<a long random string>`. Send each person their own path (on their own phone is best). They open `http://<your nas address>:8790` followed by their path, choose a passphrase only they know, and are signed in. A setup path works once.

Running it again does nothing: it refuses if the two people already exist.

## Add it to the iPhone home screen

1. Open the app in Safari on the iPhone, on the home Wi-Fi.
2. Tap the Share button, then **Add to Home Screen**, then **Add**.

It opens full screen with its own icon. It only works on the home network: there is no access from outside in this version, and there are no notifications.

## Updating

Change the code, commit, and run `./scripts/deploy.sh` again. The data stays because it lives in the volume, not in the container.

## Backup

The app keeps one consistent copy of its data in a `backup` folder inside the data volume. It writes one at start-up and then once a day, using SQLite's own copy, so it is whole even while someone is using the app. There is always just the one copy: each new one replaces the last.

Point Hyper Backup at the folder, not at the live database:

```
/volume1/@docker/volumes/tandem_data/_data/backup
```

Do not back up the live file `tandem.sqlite` on its own. While the app runs, its newest writes can sit in the `tandem.sqlite-wal` file, so a plain copy of the main file can miss them or be half written.

The snapshot holds everything the live database does, including answers that are still hidden from the other person, so treat it the same way: only the two of you and whoever looks after the NAS should be able to read it. Each person can also download everything they are allowed to see from the **Export** link at the foot of Home.

To restore from the snapshot (this replaces what is in the database now, so it is for when the data is lost or wrong):

```bash
ssh nas "sudo /usr/local/bin/docker stop tandem"
ssh nas "sudo cp /volume1/@docker/volumes/tandem_data/_data/backup/tandem-snapshot.sqlite /volume1/@docker/volumes/tandem_data/_data/tandem.sqlite && sudo rm -f /volume1/@docker/volumes/tandem_data/_data/tandem.sqlite-wal /volume1/@docker/volumes/tandem_data/_data/tandem.sqlite-shm"
ssh nas "sudo /usr/local/bin/docker start tandem"
```

## Looking after it

| To do this | Run |
|---|---|
| See the log (method, path and status only, never what anyone wrote) | `ssh nas "sudo /usr/local/bin/docker logs --tail 50 tandem"` |
| See whether it is healthy | `ssh nas "sudo /usr/local/bin/docker ps --filter name=tandem"` |
| Stop it | `ssh nas "sudo /usr/local/bin/docker stop tandem"` |
| Start it again | `ssh nas "sudo /usr/local/bin/docker start tandem"` |

The container restarts by itself after a reboot of the NAS.

## What the server owner can and cannot see

Whoever looks after the NAS can open the database file, so they could in principle read answers that are still hidden. The app hides unread check-in answers from the other person, but it does not protect them from the person who runs the server. The third welcome page says so in plain words. If that ever feels wrong for the two of you, talk about it before using the app, not after.

## A forgotten passphrase or a lost phone

There is no reset inside the app. The person who looks after the NAS makes a new setup link for one person:

```bash
ssh nas "sudo /usr/local/bin/docker exec tandem node scripts/reset-passphrase.mjs '<name>'"
```

It prints one line, `/setup/<a long random string>`. Send it to that person, who opens it on their phone and chooses a new passphrase. A reset link works once.

This does three things at once: the old passphrase stops working, that person is signed out on every phone, and any run of wrong guesses against them is cleared. The other person is not touched. Use it for a lost or stolen phone as well as a forgotten passphrase. It refuses if no one, or more than one person, has that name.
