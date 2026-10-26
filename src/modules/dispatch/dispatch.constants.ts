import { randomUUID } from 'node:crypto'

/** RabbitMQ 虚拟主机；SMS、Channel、SRM、Dispatch 的 Nacos `rabbitmq.vhost` 必须都是这个值。 */
export const SMS_RABBITMQ_VHOST = '/chat-sms'
/** 短信交换机。 */
export const SMS_EXCHANGE = 'chat.sms.exchange'
/** 提交队列：SMS 发布，Channel 消费并选路。 */
export const SMS_SUBMIT_QUEUE = 'chat.sms.submit'
export const SMS_SUBMIT_ROUTING_KEY = 'sms.submit'
/** 通道交换机：选路后按通道别名作为路由键投递到对应通道队列。 */
export const SMS_CHANNEL_EXCHANGE = 'chat.sms.channel.exchange'
/** 通道事件队列：SRM 在通道增删改、启停后发布，Dispatch 据此维护通道副本并订阅或取消通道队列。 */
export const SMS_CHANNEL_EVENT_QUEUE = 'chat.sms.channel.event'
export const SMS_CHANNEL_EVENT_ROUTING_KEY = 'sms.channel.event'
/** 通道快照队列：只保留最新一份全量补发，队列长度限制为 1。 */
export const SMS_CHANNEL_SNAPSHOT_QUEUE = 'chat.sms.channel.snapshot'
export const SMS_CHANNEL_SNAPSHOT_ROUTING_KEY = 'sms.channel.snapshot'

/** 通道队列名称。通道别名全表唯一且创建后不可修改。 */
export function smsChannelQueue(alias: string): string {
    return `chat.sms.channel.${alias}`
}
/**
 * 选路配置变更广播：SRM 在路由、规则组、路由通道、应用绑定、通道启停或删除提交后发布，
 * 每个 Channel 实例用自己的临时队列接收，收到后重新加载选路缓存。SRM 和 Channel 各声明一份，名称改动时要同步。
 */
export const SMS_ROUTE_CONFIG_EXCHANGE = 'chat.sms.route.config.exchange'
/** 本实例接收选路配置变更的临时队列：独占、连接断开自动删除，重连时由拓扑重新声明。 */
export const SMS_ROUTE_CONFIG_QUEUE = `chat.sms.route.config.${randomUUID()}`
/** 变更消息丢失或实例断线时，按数据库签名校对选路缓存的间隔。 */
export const ROUTE_CACHE_RECONCILE_INTERVAL_MS = 30_000

/** 选路配置变更消息：只带版本号，不带数据；收到后整体重新加载。 */
export interface RouteConfigChangedPayload {
    version: number
}
/** 选路失败的短信进入死信队列，供人工排查。 */
export const SMS_DEAD_EXCHANGE = 'chat.sms.dead.exchange'
export const SMS_SUBMIT_DEAD_QUEUE = 'chat.sms.submit.dead'
export const SMS_SUBMIT_DEAD_ROUTING_KEY = 'sms.submit.dead'

/** SMS 提交的短信。SMS、Channel、Dispatch 各声明一份，字段改动时要同步。 */
export interface MessageSubmitPayload {
    /** 本次提交生成的 UUID 标识，当前不落库。 */
    msgId: string
    /** 提交短信的客户主键 */
    userKeyId: number
    /** 提交短信的客户名称 */
    userName: string
    /** 提交短信的应用主键：路由的应用绑定按它查询 */
    appKeyId: number
    /** 提交短信的应用ID */
    appId: string
    /** 短信类型：MRKT、NTFY、SOTP */
    type: 'MRKT' | 'NTFY' | 'SOTP'
    /** 方向：Skyline 国家/地区主键；SMS 可能传字符串，选路前统一转数字 */
    countryKeyId: number | string
    /** 号码所在国家的 MCC */
    mcc: string
    /** 接收号码：含国际区号，不带 + 号。 */
    toNumber: string
    /** 短信内容。 */
    content: string
    /** 内容字符数 */
    contentLength: number
    /** 编码方式 */
    encoding: 'UCS2' | 'GSM7'
    /** 计费条数 */
    segments: number
    /** 客户售价：USD总额(放大百万倍存储) */
    price: number
    /** 提交时间，ISO-8601。 */
    submitTime: string
    /** 提交短信任务的ID */
    taskId?: number
    /** 提交短信任务的名称 */
    taskName?: string
    /** 提交短信的模板ID */
    templateId?: string
}

/**
 * 通道事件，携带通道完整状态。SRM 和 Dispatch 各声明一份，字段改动时要同步。
 * version 取发布时间毫秒数，Dispatch 只接受比副本更新的版本，重复或乱序投递都不会出错。
 */
/** 全量通道快照。SRM 每次启动只发布一条，队列里旧快照会丢掉。 */
export interface SmsChannelSnapshotPayload {
    version: number
    channels: SmsChannelEventPayload[]
}

export interface SmsChannelEventPayload {
    channelKeyId: number
    alias: string
    queue: string
    type: string
    countryKeyId: number
    status: string
    sendInterval: number
    maxRetry: number
    /** true 表示通道已删除。 */
    deleted: boolean
    version: number
}

/** 选路后投递到通道队列的短信。Channel 和 Dispatch 各声明一份，字段改动时要同步。 */
export interface SmsDispatchPayload extends MessageSubmitPayload {
    routeKeyId: number
    routeAlias: string
    channelKeyId: number
    channelAlias: string
    routedAt: string
}
