FROM gitea/gitea:1.25.5

COPY forgejo/custom/templates /opt/hanplanet-gitea-custom/templates
COPY forgejo/custom/public /opt/hanplanet-gitea-custom/public
COPY docker/gitea/entrypoint.sh /usr/local/bin/hanplanet-gitea-entrypoint.sh

RUN chmod +x /usr/local/bin/hanplanet-gitea-entrypoint.sh

ENTRYPOINT ["/usr/local/bin/hanplanet-gitea-entrypoint.sh"]
