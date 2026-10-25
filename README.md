# chat-web-channel-service

短信选路服务。消费 `chat.sms.submit`，直接读取 `chat-web-srm` 的路由配置，把短信推进 `chat.sms.channel.<通道别名>`。不调用 SRM 接口，也不提供业务接口。

- 端口：本地 `5091`
- Redis database：`6`，只用于健康检查
- Nacos Data ID：`chat-web-channel-service-development.yaml`
- 数据库配置键：`database.chat-web-srm`，账号 `chat_web_channel_service` 只读选路用到的 5 张表
- RabbitMQ 虚拟主机：`/chat-sms`

本地启动前复制 `.env.example` 为 `.env`，然后执行 `yarn dev`。
