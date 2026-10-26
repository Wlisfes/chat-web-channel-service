import type { ConfirmChannel } from 'amqplib'
import * as constants from '@/modules/dispatch/dispatch.constants'

/**
 * 声明选路服务用到的队列。每次重连都会执行，声明是幂等的。
 * 提交队列参数必须与 SMS 声明的完全一致，否则后声明的一方会被 RabbitMQ 拒绝。
 */
export async function setupDispatchTopology(channel: ConfirmChannel): Promise<void> {
    await channel.assertExchange(constants.SMS_EXCHANGE, 'direct', { durable: true })
    await channel.assertExchange(constants.SMS_CHANNEL_EXCHANGE, 'direct', { durable: true })
    await channel.assertExchange(constants.SMS_DEAD_EXCHANGE, 'direct', { durable: true })
    await channel.assertQueue(constants.SMS_SUBMIT_DEAD_QUEUE, { durable: true })
    await channel.bindQueue(constants.SMS_SUBMIT_DEAD_QUEUE, constants.SMS_DEAD_EXCHANGE, constants.SMS_SUBMIT_DEAD_ROUTING_KEY)
    await channel.assertQueue(constants.SMS_SUBMIT_QUEUE, {
        durable: true,
        deadLetterExchange: constants.SMS_DEAD_EXCHANGE,
        deadLetterRoutingKey: constants.SMS_SUBMIT_DEAD_ROUTING_KEY
    })
    await channel.bindQueue(constants.SMS_SUBMIT_QUEUE, constants.SMS_EXCHANGE, constants.SMS_SUBMIT_ROUTING_KEY)
    // 选路配置变更是广播：每个实例声明自己的独占队列，连接断开后队列自动删除，重连时在这里重新声明。
    await channel.assertExchange(constants.SMS_ROUTE_CONFIG_EXCHANGE, 'fanout', { durable: true })
    await channel.assertQueue(constants.SMS_ROUTE_CONFIG_QUEUE, { durable: false, exclusive: true, autoDelete: true })
    await channel.bindQueue(constants.SMS_ROUTE_CONFIG_QUEUE, constants.SMS_ROUTE_CONFIG_EXCHANGE, '')
}
