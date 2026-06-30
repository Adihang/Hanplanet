FROM php:8.3-cli-alpine

WORKDIR /app

COPY Wargame/ /app/Wargame/

RUN chmod +x /app/Wargame/docker-entrypoint.sh

EXPOSE 8090

ENTRYPOINT ["/app/Wargame/docker-entrypoint.sh"]
