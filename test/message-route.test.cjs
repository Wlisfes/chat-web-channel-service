const test = require('node:test')
const assert = require('node:assert/strict')
const { orderRoutes, routeMatches, selectChannel } = require('../dist/modules/message/message.route')

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

test('只选同方向同类型的通道，先取最小优先级，再按权重', () => {
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
    const channels = [channel(1, 1, 1), channel(2, 1, 3), channel(3, 2, 100), channel(4, 1, 100, { countryKeyId: 1008 })]
    assert.equal(selectChannel(channels, facts, () => 0).channelKeyId, 1)
    assert.equal(selectChannel(channels, facts, () => 0.9).channelKeyId, 2)
    assert.equal(selectChannel([channel(3, 2, 100)], facts, () => 0).channelKeyId, 3)
    assert.equal(selectChannel(channels, { ...facts, type: 'MRKT' }), undefined)
})
