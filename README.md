# VChat

1) `cp -r docker/nginx/default.conf docker/nginx/default.conf` + настроить домен и IP домена
2) `systemctl enable docker`
3) `docker-compose build` и `docker-compose up -d`

`docker compose run --rm  certbot certonly --webroot --webroot-path /var/www/certbot/ -d vchat.the-notebook.ru` - получить сертификат

`docker compose run --rm certbot renew` - обновить сертификат

---

# Важно!

Я написал это по приколу под пивас. Я ничего не обещаю...

И не собираюсь это поддерживать...


**Да поможет вам Бог :)**

П.С. - в `public/index.html` лучше не смотреть. Там пздц... :(