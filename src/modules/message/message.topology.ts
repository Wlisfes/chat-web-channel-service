import type { ConfirmChannel } from 'amqplib'
import * as constants from '@/modules/message/message.constants'

/**
 * 声明选路服务用到的队列。每次重连都会执行，声明是幂等的。
 * 提交队列参数必须与 SMS 声明的完全一致，否则后声明的一方会被 RabbitMQ 拒绝。
 */
export async function setupMessageTopology(channel: ConfirmChannel): Promise<void> {
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
}
