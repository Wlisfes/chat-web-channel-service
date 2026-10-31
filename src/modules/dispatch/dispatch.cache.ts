import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common'
import { EntityManager, In, InjectRepository, Repository } from '@wlisfes/chat-web-base-schema/database'
import { RabbitmqService } from '@wlisfes/chat-web-base-schema/rabbitmq'
import { type RouteCandidate, type RouteChannelCandidate, type RouteRuleCandidate } from '@/modules/dispatch/dispatch.route'
import * as Schema from '@wlisfes/chat-web-base-schema'
import * as constants from '@/modules/dispatch/dispatch.constants'

/** 选路配置快照：只包含启用的数据，选路时只读内存。 */
export interface RouteSnapshot {
    /** 按短信类型分组的启用路由，已按优先级、主键排序。 */
    routes: Map<string, RouteCandidate[]>
    /** 按路由分组的启用规则组。 */
    rules: Map<number, RouteRuleCandidate[]>
    /** 按路由分组的可用通道：路由通道和通道本身都已启用。 */
    channels: Map<number, RouteChannelCandidate[]>
    /** 启用的应用绑定：应用主键 -> 路由主键。 */
    bindings: Map<number, number>
}

/** 选路相关表名，用于计算配置签名。 */
const ROUTE_CONFIG_TABLES = ['tb_srm_route', 'tb_srm_route_app', 'tb_srm_route_rule', 'tb_srm_route_channel', 'tb_srm_channel']

function groupBy<K, T>(items: T[], key: (item: T) => K): Map<K, T[]> {
    const groups = new Map<K, T[]>()
    for (const item of items) {
        const k = key(item)
        const group = groups.get(k)
        if (group) group.push(item)
        else groups.set(k, [item])
    }
    return groups
}

/**
 * 选路配置缓存。
 *
 * - 启动时全量加载一次，加载完成后才开始消费提交队列；
 * - 收到 SRM 的配置变更广播后整体重新加载；
 * - 定时比较各表的行数和最大修改时间，变化时重新加载，兜底变更消息丢失或实例断线；
 * - 运行中重新加载失败时保留旧快照并记录日志，不清空缓存。
 */
@Injectable()
export class RouteCacheService implements OnApplicationBootstrap, OnApplicationShutdown {
    private readonly logger = new Logger(RouteCacheService.name)
    private snapshot?: RouteSnapshot
    /** 当前快照加载前读取的配置签名。 */
    private signature?: string
    /** 正在进行的加载；并发的刷新请求共用它。 */
    private loading?: Promise<void>
    /** 加载过程中又收到刷新请求时置为 true，本次加载完成后再加载一次。 */
    private dirty = false
    private timer?: NodeJS.Timeout
    /** 首次加载完成后 resolve；提交队列的消费者等它再开始消费。 */
    private readonly loaded: Promise<void>
    private markLoaded!: () => void

    constructor(
        @InjectRepository(Schema.TbSrmRoute) private readonly repository: Repository<Schema.TbSrmRoute>,
        private readonly rabbitmqService: RabbitmqService
    ) {
        this.loaded = new Promise(resolve => (this.markLoaded = resolve))
    }

    public async onApplicationBootstrap(): Promise<void> {
        await this.refresh('启动')
        this.markLoaded()
        await this.rabbitmqService.consume<constants.RouteConfigChangedPayload>(constants.SMS_ROUTE_CONFIG_QUEUE, async payload =>
            this.fetchRouteConfigChanged(payload)
        )
        this.timer = setInterval(() => void this.reconcile(), constants.ROUTE_CACHE_RECONCILE_INTERVAL_MS)
        this.timer.unref()
    }

    public onApplicationShutdown(): void {
        if (this.timer) clearInterval(this.timer)
    }

    /** 等待首次加载完成。 */
    public ready(): Promise<void> {
        return this.loaded
    }

    /** 当前快照；启动加载完成前调用会抛错。 */
    public current(): RouteSnapshot {
        if (!this.snapshot) throw new Error('选路缓存尚未加载')
        return this.snapshot
    }

    /** 收到配置变更广播。重新加载失败只记录日志，由定时校对重试，消息照常确认。 */
    private async fetchRouteConfigChanged(payload: constants.RouteConfigChangedPayload): Promise<'ack'> {
        await this.refresh(`配置变更 version=${payload?.version}`).catch(error =>
            this.logger.error(`选路缓存重新加载失败，继续使用旧快照：${this.errorMessage(error)}`)
        )
        return 'ack'
    }

    /** 定时校对：签名变化时重新加载。 */
    private async reconcile(): Promise<void> {
        try {
            if (this.loading) return
            const signature = await this.loadSignature()
            if (signature !== this.signature) await this.refresh('定时校对发现配置变化')
        } catch (error) {
            this.logger.error(`选路缓存校对失败，继续使用旧快照：${this.errorMessage(error)}`)
        }
    }

    /** 重新加载快照；正在加载时只标记，等当前加载结束后再加载一次。 */
    private async refresh(reason: string): Promise<void> {
        if (this.loading) {
            this.dirty = true
            return this.loading
        }
        this.loading = (async () => {
            try {
                do {
                    this.dirty = false
                    await this.load(reason)
                } while (this.dirty)
            } finally {
                this.loading = undefined
            }
        })()
        return this.loading
    }

    private async load(reason: string): Promise<void> {
        const startedAt = performance.now()
        // 先取签名再读数据：读数据期间发生的变更会让下次校对的签名不同，从而再加载一次。
        const signature = await this.loadSignature()
        const manager = this.repository.manager
        const [routes, bindings, rules, links, channels] = await Promise.all([
            manager.find(Schema.TbSrmRoute, {
                where: { status: Schema.TbSrmRouteStatus.ENABLE },
                select: ['keyId', 'alias', 'type', 'priority']
            }),
            manager.find(Schema.TbSrmRouteApp, {
                where: { status: Schema.TbSrmRouteAppStatus.ENABLE },
                select: ['appKeyId', 'routeKeyId']
            }),
            manager.find(Schema.TbSrmRouteRule, {
                where: { status: Schema.TbSrmRouteRuleStatus.ENABLE },
                select: ['routeKeyId', 'conditions'],
                order: { routeKeyId: 'ASC', sort: 'ASC', keyId: 'ASC' }
            }),
            manager.find(Schema.TbSrmRouteChannel, {
                where: { status: Schema.TbSrmRouteChannelStatus.ENABLE },
                select: ['routeKeyId', 'channelKeyId', 'priority', 'weight']
            }),
            manager.find(Schema.TbSrmChannel, {
                where: { status: Schema.TbSrmChannelStatus.ENABLE },
                select: ['keyId', 'alias', 'type']
            })
        ])
        const channelOptions = new Map(channels.map(channel => [channel.keyId, channel]))
        const countryKeyIds = await this.findChannelCountries(manager)
        const candidates = links.flatMap<RouteChannelCandidate>(link => {
            const channel = channelOptions.get(link.channelKeyId)
            if (!channel) return []
            return [
                {
                    routeKeyId: link.routeKeyId,
                    channelKeyId: channel.keyId,
                    channelAlias: channel.alias,
                    channelType: channel.type,
                    countryKeyIds: countryKeyIds.get(channel.keyId) ?? [],
                    priority: link.priority,
                    weight: link.weight
                }
            ]
        })
        const sortedRoutes = [...routes].sort((a, b) => a.priority - b.priority || a.keyId - b.keyId)
        this.snapshot = {
            routes: groupBy(sortedRoutes, route => String(route.type)),
            rules: groupBy(rules, rule => rule.routeKeyId),
            channels: groupBy(candidates, item => item.routeKeyId),
            bindings: new Map(bindings.map(binding => [binding.appKeyId, binding.routeKeyId]))
        }
        this.signature = signature
        this.logger.log(
            `选路缓存已加载（${reason}）：路由=${routes.length}，规则组=${rules.length}，可用路由通道=${candidates.length}，应用绑定=${bindings.length}，耗时=${Math.round(performance.now() - startedAt)}ms`
        )
    }

    /** 配置签名：各表行数和最大修改时间。新增、修改、删除都会改变签名。 */
    /** 每条启用通道当前可发送的方向：已启用绑定端口的激活方向。 */
    private async findChannelCountries(manager: EntityManager): Promise<Map<number, number[]>> {
        const bindings = await manager.find(Schema.TbSrmChannelPort, {
            where: { status: Schema.TbSrmChannelPortStatus.ENABLE },
            select: ['channelKeyId', 'portKeyId']
        })
        const portKeyIds = [...new Set(bindings.map(item => item.portKeyId))]
        if (portKeyIds.length === 0) return new Map()
        const ports = await manager.find(Schema.TbSrmSimbankPort, {
            where: { keyId: In(portKeyIds), activateStatus: Schema.TbSrmSimbankPortActivateStatus.ACTIVE },
            select: ['keyId', 'countryKeyId']
        })
        const countries = new Map(ports.filter(port => port.countryKeyId).map(port => [port.keyId, port.countryKeyId]))
        const result = new Map<number, number[]>()
        for (const binding of bindings) {
            const countryKeyId = countries.get(binding.portKeyId)
            if (!countryKeyId) continue
            const current = result.get(binding.channelKeyId) ?? []
            if (!current.includes(countryKeyId)) current.push(countryKeyId)
            result.set(binding.channelKeyId, current)
        }
        return result
    }
    private async loadSignature(): Promise<string> {
        const sql = ROUTE_CONFIG_TABLES.map(
            table => `SELECT '${table}' AS name, COUNT(*) AS total, MAX(\`modify_time\`) AS modified FROM \`${table}\``
        ).join(' UNION ALL ')
        const rows: Array<{ name: string; total: number | string; modified: Date | string | null }> =
            await this.repository.manager.query(sql)
        return rows
            .map(row => `${row.name}:${row.total}:${row.modified instanceof Date ? row.modified.getTime() : String(row.modified ?? '')}`)
            .join('|')
    }

    private errorMessage(error: unknown): string {
        return error instanceof Error ? error.message : String(error)
    }
}
