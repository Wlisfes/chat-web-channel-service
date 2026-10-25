import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common'
import { orderRoutes, routeMatches, selectChannel, type RouteChannelCandidate, type RouteFacts } from '@/modules/dispatch/dispatch.route'
import { In, InjectRepository, Repository } from '@wlisfes/chat-web-base-schema/database'
import { RabbitmqService } from '@wlisfes/chat-web-base-schema/rabbitmq'
import * as Schema from '@wlisfes/chat-web-base-schema'
import * as constants from '@/modules/dispatch/dispatch.constants'

/** 选路结果；没有可用通道时为 undefined。 */
type RouteResult = Pick<constants.SmsDispatchPayload, 'routeKeyId' | 'routeAlias' | 'channelKeyId' | 'channelAlias'>

/** 消费 SMS 提交的短信，按路由规则选出通道后投递到该通道的队列 chat.sms.channel.<通道别名>。当前不落库。 */
@Injectable()
export class DispatchService implements OnApplicationBootstrap {
    private readonly logger = new Logger(DispatchService.name)

    constructor(
        @InjectRepository(Schema.TbSrmRoute) private readonly repository: Repository<Schema.TbSrmRoute>,
        private readonly rabbitmqService: RabbitmqService
    ) {}

    public async onApplicationBootstrap(): Promise<void> {
        await this.rabbitmqService.consume<constants.SmsSubmitPayload>(constants.SMS_SUBMIT_QUEUE, async message =>
            this.fetchRouteSubmit(message)
        )
    }

    /** 选路并投递到通道队列。具名方法才能让日志打出执行方法。 */
    private async fetchRouteSubmit(message: constants.SmsSubmitPayload): Promise<'ack' | 'reject'> {
        const startedAt = performance.now()
        const elapsed = () => `${Math.round(performance.now() - startedAt)}ms`
        try {
            const route = await this.findRoute(message)
            if (!route) {
                this.logger.warn(`没有可用路由或通道，短信进入死信队列：messageId=${message.messageId}，耗时=${elapsed()}`)
                return 'reject'
            }
            const payload: constants.SmsDispatchPayload = { ...message, ...route, routedAt: new Date().toISOString() }
            await this.rabbitmqService.publish(constants.SMS_CHANNEL_EXCHANGE, route.channelAlias, payload, {
                messageId: message.messageId
            })
            this.logger.log(
                `短信已选路：messageId=${message.messageId}，route=${route.routeAlias}，channel=${route.channelAlias}，耗时=${elapsed()}`
            )
            return 'ack'
        } catch (error) {
            this.logger.error(
                `选路失败：messageId=${message.messageId}，耗时=${elapsed()}，原因=${error instanceof Error ? error.message : String(error)}`
            )
            throw error
        }
    }

    /** 读取启用的路由、规则组和通道，依次尝试每条路由。 */
    private async findRoute(message: constants.SmsSubmitPayload): Promise<RouteResult | undefined> {
        const facts: RouteFacts = {
            appKeyId: message.appKeyId,
            type: message.type,
            countryKeyId: message.countryKeyId,
            toNumber: message.toNumber
        }
        const manager = this.repository.manager
        const routes = await manager.find(Schema.TbSrmRoute, {
            // 路由类型与短信类型取值一致，但两边枚举分开定义。
            where: { type: facts.type as Schema.TbSrmRouteType, status: Schema.TbSrmRouteStatus.ENABLE },
            select: ['keyId', 'alias', 'priority']
        })
        if (routes.length === 0) return undefined
        const routeKeyIds = routes.map(route => route.keyId)
        const [binding, rules, links] = await Promise.all([
            manager.findOne(Schema.TbSrmRouteApp, {
                where: { appKeyId: facts.appKeyId, status: Schema.TbSrmRouteAppStatus.ENABLE },
                select: ['routeKeyId']
            }),
            manager.find(Schema.TbSrmRouteRule, {
                where: { routeKeyId: In(routeKeyIds), status: Schema.TbSrmRouteRuleStatus.ENABLE },
                select: ['routeKeyId', 'conditions']
            }),
            manager.find(Schema.TbSrmRouteChannel, {
                where: { routeKeyId: In(routeKeyIds), status: Schema.TbSrmRouteChannelStatus.ENABLE },
                select: ['routeKeyId', 'channelKeyId', 'priority', 'weight']
            })
        ])
        const channels = links.length
            ? await manager.find(Schema.TbSrmChannel, {
                  where: { keyId: In(links.map(link => link.channelKeyId)), status: Schema.TbSrmChannelStatus.ENABLE },
                  select: ['keyId', 'alias', 'type', 'countryKeyId']
              })
            : []
        const channelOptions = new Map(channels.map(channel => [channel.keyId, channel]))
        const candidates: RouteChannelCandidate[] = links.flatMap(link => {
            const channel = channelOptions.get(link.channelKeyId)
            if (!channel) return []
            return [
                {
                    routeKeyId: link.routeKeyId,
                    channelKeyId: channel.keyId,
                    channelAlias: channel.alias,
                    channelType: channel.type,
                    countryKeyId: channel.countryKeyId,
                    priority: link.priority,
                    weight: link.weight
                }
            ]
        })
        for (const route of orderRoutes(routes, binding?.routeKeyId)) {
            if (!routeMatches(route.keyId, rules, facts)) continue
            const channel = selectChannel(
                candidates.filter(item => item.routeKeyId === route.keyId),
                facts
            )
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
