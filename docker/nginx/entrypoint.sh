#!/bin/sh
set -e

# Обрабатываем шаблоны через envsubst для подстановки переменных из .env
# Всегда создаем default.conf из шаблона, чтобы избежать проблем с монтированием
if [ "$NGINX_CONFIG_FILE" = "prod.default.conf" ]; then
    echo "Using production config - processing template with envsubst"
    if [ -f "/etc/nginx/conf.d/prod.default.conf.template" ]; then
        envsubst '${APP_DOMAIN} ${REACT_APP_COTURN_IP}' < /etc/nginx/conf.d/prod.default.conf.template > /etc/nginx/conf.d/default.conf
        echo "Processed nginx config template with variables: APP_DOMAIN=${APP_DOMAIN}, REACT_APP_COTURN_IP=${REACT_APP_COTURN_IP}"
    else
        echo "Error: prod.default.conf.template not found"
        exit 1
    fi
elif [ "$NGINX_CONFIG_FILE" = "dev.default.conf" ]; then
    echo "Using development config - processing template with envsubst"
    if [ -f "/etc/nginx/conf.d/dev.default.conf.template" ]; then
        envsubst '${APP_DOMAIN}' < /etc/nginx/conf.d/dev.default.conf.template > /etc/nginx/conf.d/default.conf
        echo "Processed nginx config template with variable: APP_DOMAIN=${APP_DOMAIN}"
    else
        echo "Error: dev.default.conf.template not found"
        exit 1
    fi
else
    echo "Error: Unknown NGINX_CONFIG_FILE: $NGINX_CONFIG_FILE"
    exit 1
fi

exec nginx -g 'daemon off;'
