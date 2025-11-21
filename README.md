# VChat - Simple WebRTC video chat

Простой чат типа Discord "на минималках"...

Как запустить:

1) `cp .env.example .env` - и настройте его

2) Соберите фронтенд:
```bash
docker-compose run --rm npm install

docker-compose run --rm npm run build
```

3) Соберите и запустите все Docker контейнеры:
```bash
docker-compose build && docker-compose up -d 
```

---

Получить сертификат:
```
docker compose run --rm  certbot certonly --webroot --webroot-path /var/www/certbot/ -d <ВАШ_ДОМЕН>
```
Возможно удобнее это будет сделать на `dev.default.conf`, а потом включить `prod.default.conf`, после того, как сертификаты сгенерируются

---

Обновить сертификат:
```
docker compose run --rm certbot renew
```

---

`systemctl enable docker` - это скорее всего Вам не надо. Но я оставлю эту комманду :)

---

# Важно!

Я написал это по приколу под пивас. И ничего не обещаю...

И не собираюсь это поддерживать...


**Да поможет вам Бог :)**