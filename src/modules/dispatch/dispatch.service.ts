import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common'
import { ChannelBalancer, orderRoutes, routeMatches, selectChannel, type RouteFacts } from '@/modules/dispatch/dispatch.route'
import { RouteCacheService } from '@/modules/dispatch/dispatch.cache'
import { RabbitmqService } from '@wlisfes/chat-web-base-schema/rabbitmq'
import * as constants from '@/modules/dispatch/dispatch.constants'

/** 选路结果；没有可用通道时为 undefined。 */
type RouteResult = Pick<constants.SmsDispatchPayload, 'routeKeyId' | 'routeAlias' | 'channelKeyId' | 'channelAlias'>

/** 消费 SMS 提交的短信，按内存中的选路配置选出通道后投递到该通道的队列 chat.sms.channel.<通道别名>。当前不落库。 */
@Injectable()
export class DispatchService implements OnApplicationBootstrap {
    private readonly logger = new Logger(DispatchService.name)
    /** 同优先级通道之间的平滑加权轮询状态；权重相同时均衡轮流提交。 */
    private readonly balancer = new ChannelBalancer()

    constructor(
        private readonly routeCacheService: RouteCacheService,
        private readonly rabbitmqService: RabbitmqService
    ) {}

    public async onApplicationBootstrap(): Promise<void> {
        // 选路缓存加载完成后再消费，避免启动瞬间的短信因缓存为空进入死信队列。
        await this.routeCacheService.ready()
        await this.rabbitmqService.consume<constants.MessageSubmitPayload>(constants.SMS_SUBMIT_QUEUE, async message =>
            this.fetchRouteSubmit(message)
        )
    }

    /** 选路并投递到通道队列。具名方法才能让日志打出执行方法。 */
    private async fetchRouteSubmit(message: constants.MessageSubmitPayload): Promise<'ack' | 'reject'> {
        const startedAt = performance.now()
        const elapsed = () => `${Math.round(performance.now() - startedAt)}ms`
        try {
            const route = this.findRoute(message)
            if (!route) {
                this.logger.warn(`没有可用路由或通道，短信进入死信队列：msgId=${message.msgId}，耗时=${elapsed()}`)
                return 'reject'
            }
            const payload: constants.SmsDispatchPayload = {
                ...message,
                ...route,
                routedAt: new Date().toISOString()
            }
            await this.rabbitmqService.publish(constants.SMS_CHANNEL_EXCHANGE, route.channelAlias, payload, {
                messageId: message.msgId
            })
            this.logger.log(
                `已选通道：msgId=${message.msgId}，type=${payload.type}，mcc=${payload.mcc}，routeAlias=${route.routeAlias}，channelAlias=${route.channelAlias}，耗时=${elapsed()}`
            )
            return 'ack'
        } catch (error) {
            this.logger.error(
                `选路失败：msgId=${message.msgId}，耗时=${elapsed()}，原因=${error instanceof Error ? error.message : String(error)}`
            )
            throw error
        }
    }

    /** 按内存快照选路：应用绑定的路由排第一，其余同类型路由按优先级排序，依次尝试每条路由。 */
    private findRoute(message: constants.MessageSubmitPayload): RouteResult | undefined {
        const facts: RouteFacts = {
            appKeyId: Number(message.appKeyId),
            type: message.type,
            countryKeyId: Number(message.countryKeyId),
            toNumber: message.toNumber
        }
        const snapshot = this.routeCacheService.current()
        const routes = snapshot.routes.get(facts.type) ?? []
        for (const route of orderRoutes(routes, snapshot.bindings.get(facts.appKeyId))) {
            if (!routeMatches(route.keyId, snapshot.rules.get(route.keyId) ?? [], facts)) continue
            const channel = selectChannel(snapshot.channels.get(route.keyId) ?? [], facts, this.balancer)
            if (channel) {
                return {
                    routeKeyId: route.keyId,
                    routeAlias: route.alias,
                    channelKeyId: channel.channelKeyId,
                    channelAlias: channel.channelAlias
                }
            }
        }
        return undefined
    }
}
