#!/bin/sh
set -eu

cd /app/Wargame

mkdir -p data

if [ ! -f data/wargame.sqlite3 ]; then
    php scripts/init_db.php
fi

exec php -S 0.0.0.0:8090 -t public
