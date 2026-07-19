FROM php:8.3-apache

ENV WARGAME_TRUST_PROXY=1 \
    WARGAME_PUBLIC_URL=https://wargame.hanplanet.com/ \
    WARGAME_DJANGO_BASE_URL=https://www.hanplanet.com

WORKDIR /app/Wargame

RUN test "$(php -r 'echo extension_loaded("pdo_sqlite") ? "yes" : "no";')" = "yes" \
    && a2enmod headers rewrite \
    && cp "$PHP_INI_DIR/php.ini-production" "$PHP_INI_DIR/php.ini" \
    && sed -ri \
        -e 's/^expose_php = On/expose_php = Off/' \
        -e 's!^;open_basedir =!open_basedir = "/app/Wargame:/tmp:/etc/ssl"!' \
        -e 's/^disable_functions =$/disable_functions = exec,passthru,shell_exec,system,proc_open,popen/' \
        -e 's!^;?session.save_path =.*!session.save_path = "/app/Wargame/data/sessions"!' \
        -e 's/^session.use_strict_mode = 0/session.use_strict_mode = 1/' \
        -e 's/^session.use_only_cookies = 1/session.use_only_cookies = 1/' \
        -e 's/^session.cookie_httponly =$/session.cookie_httponly = 1/' \
        -e 's/^session.cookie_samesite =$/session.cookie_samesite = Lax/' \
        "$PHP_INI_DIR/php.ini" \
    && sed -ri 's/^Listen 80$/Listen 8090/' /etc/apache2/ports.conf \
    && sed -i '1i ServerName wargame.hanplanet.com' /etc/apache2/apache2.conf

COPY --chown=root:root Wargame/app/ /app/Wargame/app/
COPY --chown=root:root Wargame/public/ /app/Wargame/public/
COPY --chown=root:root Wargame/database/ /app/Wargame/database/
COPY --chown=root:root Wargame/scripts/ /app/Wargame/scripts/
COPY --chown=root:root Wargame/docker-entrypoint.sh /app/Wargame/docker-entrypoint.sh
COPY --chown=root:root Wargame/deploy/apache/wargame-vhost.conf /etc/apache2/sites-available/000-default.conf

RUN sed -ri \
        -e '/^Listen 127\.0\.0\.1:8090$/d' \
        -e 's#/Users/imhanbyeol/Development/Hanplanet/Wargame#/app/Wargame#g' \
        -e 's#ErrorLog "/app/Wargame/data/apache-error.log"#ErrorLog /proc/self/fd/2#' \
        -e 's#CustomLog "/app/Wargame/data/apache-access.log"#CustomLog /proc/self/fd/1#' \
        /etc/apache2/sites-available/000-default.conf \
    && mkdir -p /app/Wargame/data/sessions /app/Wargame/data/instances \
    && chown -R www-data:www-data /app/Wargame/data /var/run/apache2 /var/lock/apache2 /var/log/apache2 \
    && chmod 770 /app/Wargame/data /app/Wargame/data/instances \
    && chmod 700 /app/Wargame/data/sessions \
    && chmod 0555 /app/Wargame/docker-entrypoint.sh

USER www-data:www-data

EXPOSE 8090

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD php -r 'exit(@file_get_contents("http://127.0.0.1:8090/") === false ? 1 : 0);'

ENTRYPOINT ["/app/Wargame/docker-entrypoint.sh"]
CMD ["apache2-foreground"]
