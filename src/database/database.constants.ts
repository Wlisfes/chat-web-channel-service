/** 选路服务只读 chat-web-srm，不调用 SRM 接口。 */
export const CHANNEL_MYSQL_CONFIG_KEY = 'database.chat-web-srm'

/** 业务表由 SRM 拥有，这里只注册选路要读的实体，不在本服务建表。 */
export const CHANNEL_MYSQL_ENTITIES = []
