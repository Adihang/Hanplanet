#!/bin/sh
set -eu

umask 007
cd /app/Wargame

for runtime_dir in data data/sessions data/instances data/mail; do
    mkdir -p "$runtime_dir"
    if [ ! -w "$runtime_dir" ]; then
        echo "Wargame runtime directory is not writable: $runtime_dir" >&2
        exit 1
    fi
done

chmod 700 data/sessions
chmod 770 data data/instances data/mail

php scripts/init_db.php

exec "$@"
