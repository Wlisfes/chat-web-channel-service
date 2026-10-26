/** 选路时使用的短信事实。 */
export interface RouteFacts {
    /** 应用主键：用于查找应用绑定的路由。 */
    appKeyId: number
    type: string
    countryKeyId: number
    toNumber: string
}

export interface RouteCandidate {
    keyId: number
    alias: string
    priority: number
}

export interface RouteRuleCandidate {
    routeKeyId: number
    conditions: Array<{ field: string; operator: string; value: string[] }>
}

export interface RouteChannelCandidate {
    routeKeyId: number
    channelKeyId: number
    channelAlias: string
    channelType: string
    countryKeyId: number
    priority: number
    weight: number
}

/** 应用绑定的路由排第一，其余同类型路由按优先级从小到大、主键从小到大。只传启用的路由。 */
export function orderRoutes(routes: RouteCandidate[], boundRouteKeyId?: number): RouteCandidate[] {
    const sorted = [...routes].sort((a, b) => a.priority - b.priority || a.keyId - b.keyId)
    const bound = sorted.find(route => route.keyId === boundRouteKeyId)
    return bound ? [bound, ...sorted.filter(route => route !== bound)] : sorted
}

/** 同一路由的规则组之间是“或”，组内条件之间是“且”；没有规则组的路由不接收短信。只传启用的规则组。 */
export function routeMatches(routeKeyId: number, rules: RouteRuleCandidate[], facts: RouteFacts): boolean {
    const groups = rules.filter(rule => rule.routeKeyId === routeKeyId && rule.conditions?.length)
    return groups.some(rule => rule.conditions.every(condition => conditionMatches(condition, facts)))
}

function conditionMatches(condition: RouteRuleCandidate['conditions'][number], facts: RouteFacts): boolean {
    const values = condition.value ?? []
    switch (condition.operator) {
        case 'in':
            return values.includes(conditionTarget(condition.field, facts))
        case 'not_in':
            return !values.includes(conditionTarget(condition.field, facts))
        case 'prefix':
            return values.some(prefix => facts.toNumber.startsWith(prefix))
        case 'not_prefix':
            return !values.some(prefix => facts.toNumber.startsWith(prefix))
        default:
            return false
    }
}

function conditionTarget(field: string, facts: RouteFacts): string {
    if (field === 'country') return String(facts.countryKeyId)
    if (field === 'type') return facts.type
    return facts.toNumber
}

/**
 * 平滑加权轮询（与 Nginx upstream 相同的算法）。
 *
 * - 每次选择时，组内每个通道的当前值加上自己的权重，选当前值最大的通道，被选中的通道当前值减去组内总权重；
 * - 权重相同时严格轮流：A、B、C、A、B、C……；权重不同时按比例分配且尽量分散，例如 3:1 得到 A、A、B、A；
 * - 状态只保存在本实例内存，多个 Channel 实例各自轮询，整体仍接近均衡；
 * - 通道增删或权重变化时，组内已不存在的通道状态会被丢弃，新通道从 0 开始。
 */
export class ChannelBalancer {
    /** 分组键 -> 通道主键 -> 当前值。 */
    private readonly groups = new Map<string, Map<number, number>>()

    public pick(key: string, channels: RouteChannelCandidate[]): RouteChannelCandidate {
        const previous = this.groups.get(key) ?? new Map<number, number>()
        const state = new Map<number, number>()
        const total = channels.reduce((sum, item) => sum + item.weight, 0)
        let selected = channels[0]
        let best = -Infinity
        for (const item of channels) {
            const current = (previous.get(item.channelKeyId) ?? 0) + item.weight
            state.set(item.channelKeyId, current)
            if (current > best) {
                best = current
                selected = item
            }
        }
        state.set(selected.channelKeyId, best - total)
        this.groups.set(key, state)
        return selected
    }

    /** 清空所有轮询状态。 */
    public clear(): void {
        this.groups.clear()
    }
}

/**
 * 在一条路由里选通道：只看同方向、同类型、权重大于 0 的通道，先取最小优先级，
 * 同优先级内按平滑加权轮询分配；权重相同时就是均衡轮流。只传启用的通道。
 */
export function selectChannel(
    channels: RouteChannelCandidate[],
    facts: RouteFacts,
    balancer: ChannelBalancer
): RouteChannelCandidate | undefined {
    const available = channels.filter(
        item => item.channelType === facts.type && item.countryKeyId === facts.countryKeyId && item.weight > 0
    )
    if (available.length === 0) return undefined
    const top = Math.min(...available.map(item => item.priority))
    // 按通道主键排序，保证同一组每次的遍历顺序一致，轮询顺序稳定。
    const group = available.filter(item => item.priority === top).sort((a, b) => a.channelKeyId - b.channelKeyId)
    if (group.length === 1) return group[0]
    const key = `${group[0].routeKeyId}:${facts.type}:${facts.countryKeyId}:${top}`
    return balancer.pick(key, group)
}
