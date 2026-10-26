const test = require('node:test')
const assert = require('node:assert/strict')
const { ChannelBalancer, orderRoutes, routeMatches, selectChannel } = require('../dist/modules/dispatch/dispatch.route')

const facts = { appKeyId: 1001, type: 'SOTP', countryKeyId: 1007, toNumber: '85251234567' }

test('应用绑定的路由排第一，其余按优先级', () => {
    const routes = [
        { keyId: 2, alias: 'B', priority: 1 },
        { keyId: 3, alias: 'C', priority: 5 },
        { keyId: 1, alias: 'A', priority: 9 }
    ]
    assert.deepEqual(
        orderRoutes(routes, 1).map(item => item.keyId),
        [1, 2, 3]
    )
    assert.deepEqual(
        orderRoutes(routes).map(item => item.keyId),
        [2, 3, 1]
    )
    assert.deepEqual(
        orderRoutes(routes, 99).map(item => item.keyId),
        [2, 3, 1]
    )
})

test('规则组之间是或，组内条件是且；没有规则组时不接收', () => {
    const rules = [
        {
            routeKeyId: 1,
            conditions: [
                { field: 'country', operator: 'in', value: ['1007'] },
                { field: 'prefix', operator: 'prefix', value: ['852'] }
            ]
        },
        { routeKeyId: 1, conditions: [{ field: 'type', operator: 'in', value: ['MRKT'] }] },
        { routeKeyId: 3, conditions: [{ field: 'prefix', operator: 'not_prefix', value: ['852'] }] }
    ]
    assert.equal(routeMatches(1, rules, facts), true)
    assert.equal(routeMatches(1, rules, { ...facts, toNumber: '639123' }), false)
    assert.equal(routeMatches(2, rules, facts), false)
    assert.equal(routeMatches(3, rules, facts), false)
})

const channel = (channelKeyId, priority, weight, extra = {}) => ({
    routeKeyId: 1,
    channelKeyId,
    channelAlias: 'TSK-' + channelKeyId,
    channelType: 'SOTP',
    countryKeyId: 1007,
    priority,
    weight,
    ...extra
})

/** 连续选 times 次，返回选中的通道主键序列。 */
function pickSequence(channels, times, balancer = new ChannelBalancer()) {
    return Array.from({ length: times }, () => selectChannel(channels, facts, balancer).channelKeyId)
}

test('只选同方向同类型的通道，先取最小优先级', () => {
    const channels = [channel(1, 1, 1), channel(2, 1, 3), channel(3, 2, 100), channel(4, 1, 100, { countryKeyId: 1008 })]
    assert.ok(pickSequence(channels, 8).every(keyId => keyId === 1 || keyId === 2))
    assert.equal(selectChannel([channel(3, 2, 100)], facts, new ChannelBalancer()).channelKeyId, 3)
    assert.equal(selectChannel(channels, { ...facts, type: 'MRKT' }, new ChannelBalancer()), undefined)
    assert.equal(selectChannel([channel(5, 1, 0)], facts, new ChannelBalancer()), undefined)
})

test('权重相同时严格轮流提交', () => {
    const channels = [channel(3, 1, 10), channel(1, 1, 10), channel(2, 1, 10)]
    assert.deepEqual(pickSequence(channels, 6), [1, 2, 3, 1, 2, 3])
})

test('权重不同时按比例平滑分配', () => {
    const sequence = pickSequence([channel(1, 1, 3), channel(2, 1, 1)], 8)
    assert.deepEqual(sequence, [1, 1, 2, 1, 1, 1, 2, 1])
    assert.equal(sequence.filter(keyId => keyId === 1).length, 6)
})

test('通道增减后轮询继续均衡', () => {
    const balancer = new ChannelBalancer()
    assert.deepEqual(pickSequence([channel(1, 1, 1), channel(2, 1, 1)], 3, balancer), [1, 2, 1])
    assert.deepEqual(pickSequence([channel(1, 1, 1), channel(2, 1, 1), channel(3, 1, 1)], 6, balancer).sort(), [1, 1, 2, 2, 3, 3])
})
