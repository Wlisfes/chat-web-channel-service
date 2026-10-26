import 'dotenv/config'
import { NestFactory } from '@nestjs/core'
import { NestExpressApplication } from '@nestjs/platform-express'
import { setupSwagger } from '@wlisfes/chat-web-base-schema'
import { ReadableConsoleLogger, createRequestLoggingMiddleware } from '@wlisfes/chat-web-base-schema/logging'
import { requestContextMiddleware } from '@wlisfes/chat-web-base-schema/request-context'
import { AppModule } from '@/app.module'

const logger = new ReadableConsoleLogger({
    NODE_ENV: process.env.NODE_ENV,
    prefix: process.env.NACOS_SERVICE_NAME
})

const requestLoggingMiddleware = createRequestLoggingMiddleware(process.env.NACOS_SERVICE_NAME)

function shouldSkipRequestLog(requestUrl: string | undefined): boolean {
    const pathname = (requestUrl || '/').split('?')[0]
    return (
        pathname === '/api/swagger' ||
        pathname.includes('/api/swagger/') ||
        pathname.endsWith('/api/swagger-json') ||
        pathname.endsWith('/doc.html') ||
        pathname.endsWith('/services.json') ||
        pathname.endsWith('/favicon.ico') ||
        /\.(?:png|jpe?g|gif|svg|webp|ico|bmp|pdf|zip|xlsx|xls|docx|doc|csv)$/i.test(pathname) ||
        /\/(?:attachment|attachments|upload|uploads|download|downloads|file|files)\/.+/i.test(pathname)
    )
}
async function bootstrap() {
    const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger })
    app.enableShutdownHooks()
    app.use(requestContextMiddleware)
    app.use((request, response, next) => {
        if (shouldSkipRequestLog(request.originalUrl || request.url)) {
            next()
            return
        }
        requestLoggingMiddleware(request, response, next)
    })
    return await setupSwagger(app, {
        title: 'Chat Web Channel 服务 API',
        description: '短信选路服务，只消费提交队列，不提供业务接口',
        port: process.env.PORT,
        NODE_ENV: process.env.NODE_ENV ?? 'development'
    }).then(async event => {
        logger.log(`Chat Web Channel 服务启动[${event.NODE_ENV}]：http://127.0.0.1:${event.port}`)
        logger.log(`Swagger 文档：http://127.0.0.1:${event.port}/api/swagger`)
    })
}

void bootstrap().catch(error => {
    logger.error(error, 'Bootstrap')
    process.exitCode = 1
})
