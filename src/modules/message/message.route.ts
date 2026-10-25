/** 选路时使用的短信事实。 */
export interface RouteFacts {
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

/** 在一条路由里选通道：只看同方向、同类型的通道，先取最小优先级，再按权重抽取。只传启用的通道。 */
export function selectChannel(
    channels: RouteChannelCandidate[],
    facts: RouteFacts,
    random: () => number = Math.random
): RouteChannelCandidate | undefined {
    const available = channels.filter(
        item => item.channelType === facts.type && item.countryKeyId === facts.countryKeyId && item.weight > 0
    )
    if (available.length === 0) return undefined
    const top = Math.min(...available.map(item => item.priority))
    const group = available.filter(item => item.priority === top)
    let cursor = random() * group.reduce((sum, item) => sum + item.weight, 0)
    for (const item of group) {
        cursor -= item.weight
        if (cursor < 0) return item
    }
    return group[group.length - 1]
}
