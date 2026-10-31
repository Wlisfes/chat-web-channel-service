#!/bin/sh
set -eu

# 选路服务不建库。账号已存在时不改密码，避免覆盖 Nacos 中的凭据。
USERNAME=${CHANNEL_MYSQL_USERNAME:-chat_web_channel_service}
MYSQL_CONTAINER=${CHANNEL_MYSQL_CONTAINER:-chat-web-mysql}
RABBIT_CONTAINER=${CHANNEL_RABBIT_CONTAINER:-chat-web-rabbitmq}
PASSWORD_FILE=${CHANNEL_PASSWORD_FILE:-/opt/chat-web-channel-service/.channel-password}

docker inspect "$MYSQL_CONTAINER" >/dev/null
docker inspect "$RABBIT_CONTAINER" >/dev/null

grant_tables() {
    sql=$(cat <<'SQL'
GRANT SELECT ON `chat-web-srm`.`tb_srm_route` TO '$USERNAME'@'%';
GRANT SELECT ON `chat-web-srm`.`tb_srm_route_app` TO '$USERNAME'@'%';
GRANT SELECT ON `chat-web-srm`.`tb_srm_route_rule` TO '$USERNAME'@'%';
GRANT SELECT ON `chat-web-srm`.`tb_srm_route_channel` TO '$USERNAME'@'%';
GRANT SELECT ON `chat-web-srm`.`tb_srm_channel` TO '$USERNAME'@'%';
GRANT SELECT ON `chat-web-srm`.`tb_srm_channel_port` TO '$USERNAME'@'%';
GRANT SELECT ON `chat-web-srm`.`tb_srm_simbank_port` TO '$USERNAME'@'%';
FLUSH PRIVILEGES;
SQL
)
    printf '%s\n' "$sql" | docker exec -i "$MYSQL_CONTAINER" sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD"'
}

user_count=$(docker exec "$MYSQL_CONTAINER" sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" -N -e "SELECT COUNT(*) FROM mysql.user WHERE user=\"'"$USERNAME"'\" AND host=\"%\""')
if [ "$user_count" != "0" ]; then
    echo "Channel read-only account exists, refreshing grants"
    grant_tables
    echo "Channel grants refreshed"
    exit 0
fi

if [ -s "$PASSWORD_FILE" ]; then
    password=$(tr -d '\r\n' < "$PASSWORD_FILE")
else
    password=$(docker run --rm node:22-alpine node -e "process.stdout.write(require('node:crypto').randomBytes(24).toString('base64url'))")
    umask 077
    mkdir -p "$(dirname "$PASSWORD_FILE")"
    printf '%s\n' "$password" > "$PASSWORD_FILE"
    chmod 600 "$PASSWORD_FILE"
fi
sql=$(cat <<SQL
CREATE USER IF NOT EXISTS '$USERNAME'@'%' IDENTIFIED BY '$password';
ALTER USER '$USERNAME'@'%' IDENTIFIED BY '$password';
SQL
)
printf '%s\n' "$sql" | docker exec -i "$MYSQL_CONTAINER" sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD"'
grant_tables
if ! docker exec "$RABBIT_CONTAINER" rabbitmqctl list_users | awk '{print $1}' | grep -qx "$USERNAME"; then
    docker exec "$RABBIT_CONTAINER" rabbitmqctl add_user "$USERNAME" "$password"
fi
docker exec "$RABBIT_CONTAINER" rabbitmqctl set_permissions -p /chat-sms "$USERNAME" ".*" ".*" ".*"
echo "Channel account ready"
