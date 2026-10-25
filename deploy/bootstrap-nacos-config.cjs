'use strict'

/** 校验 Channel 生产 Nacos 配置，并给网关追加 /api/channel。已有配置不覆盖。 */

function required(name, environment = process.env) {
    const value = environment[name]
    if (typeof value !== 'string' || !value.trim()) throw new Error('缺少环境变量：' + name)
    return value.trim()
}

function getBaseUrl(environment = process.env) {
    const server = required('NACOS_SERVER', environment)
    return (/^https?:\/\//i.test(server) ? server : 'http://' + server).replace(/\/$/, '')
}

async function getNacosAccessToken(environment = process.env) {
    const username = environment.NACOS_USERNAME?.trim()
    const password = environment.NACOS_PASSWORD
    if (!username || password === undefined) return undefined
    const response = await fetch(getBaseUrl(environment) + '/nacos/v1/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ username, password })
    })
    if (!response.ok) throw new Error('Nacos 鉴权失败：HTTP ' + response.status)
    const result = await response.json()
    if (typeof result.accessToken !== 'string' || !result.accessToken.trim()) throw new Error('Nacos 鉴权响应缺少 accessToken')
    return result.accessToken
}

async function configUrl(dataId, environment = process.env) {
    const parameters = new URLSearchParams({
        dataId,
        group: environment.NACOS_CONFIG_GROUP?.trim() || 'DEFAULT_GROUP',
        tenant: environment.NACOS_NAMESPACE?.trim() || 'public'
    })
    const accessToken = await getNacosAccessToken(environment)
    if (accessToken) parameters.set('accessToken', accessToken)
    return getBaseUrl(environment) + '/nacos/v1/cs/configs?' + parameters
}

async function readConfig(dataId, environment = process.env) {
    const response = await fetch(await configUrl(dataId, environment))
    if (response.status === 404) return undefined
    if (!response.ok) throw new Error('读取 Nacos 配置失败：' + dataId + ' HTTP ' + response.status)
    const content = await response.text()
    return content.trim() ? content.replace(/\r\n?/g, '\n') : undefined
}

async function writeConfig(dataId, content, environment = process.env) {
    const response = await fetch(await configUrl(dataId, environment), {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ content })
    })
    if (!response.ok) throw new Error('写入 Nacos 配置失败：' + dataId + ' HTTP ' + response.status)
}

function validateChannelConfig(content) {
    if (!content.includes('port: 5090')) throw new Error('Channel Nacos 配置缺少 server.port: 5090')
    if (!content.includes('chat-web-srm:')) throw new Error('Channel Nacos 配置缺少 database.chat-web-srm')
    if (!/database:\s*6/.test(content)) throw new Error('Channel Redis database 必须为 6')
    if (!content.includes('vhost: /chat-sms')) throw new Error('Channel RabbitMQ vhost 必须为 /chat-sms')
    if (!content.includes('service_token:') || !content.includes('secret:')) throw new Error('Channel Nacos 配置缺少网关凭据')
    return content
}

function ensureGatewayRoute(content) {
    const prefix = '/api/channel'
    if (content.includes('prefix: ' + prefix) || content.includes('prefix: "' + prefix + '"')) return content
    const block = [
        '    - id: channel',
        '      prefix: /api/channel',
        '      serviceName: chat-web-channel-service',
        '      fallbackUrl: http://chat-web-channel-service:5090',
        '      fallbackEnabled: false',
        '      enabled: true',
        ''
    ].join('\n')
    const marker = '    - id: srm\n'
    if (content.includes(marker)) return content.replace(marker, block + marker)
    const routesHeader = 'routes:\n'
    const routesAt = content.indexOf(routesHeader)
    if (routesAt < 0) throw new Error('网关配置缺少 routes，无法追加 /api/channel')
    const insertAt = routesAt + routesHeader.length
    return content.slice(0, insertAt) + block + content.slice(insertAt)
}

async function main() {
    const dataId = process.env.NACOS_CONFIG_DATA_ID?.trim() || 'chat-web-channel-service.yaml'
    const existing = await readConfig(dataId)
    if (!existing) throw new Error('未找到 ' + dataId + '，请先创建生产 Nacos 配置')
    validateChannelConfig(existing)
    for (const gatewayId of ['chat-web-gateway-service.yaml', 'chat-web-gateway-service-development.yaml']) {
        const gateway = await readConfig(gatewayId)
        if (!gateway) continue
        const updated = ensureGatewayRoute(gateway)
        if (updated !== gateway) await writeConfig(gatewayId, updated)
    }
    process.stdout.write('Channel Nacos 配置已校验，网关路由已检查\n')
}

if (require.main === module) {
    main().catch(error => {
        process.stderr.write((error instanceof Error ? error.message : String(error)) + '\n')
        process.exitCode = 1
    })
}
