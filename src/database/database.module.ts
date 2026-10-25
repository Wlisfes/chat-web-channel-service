import { Global, Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { NacosService } from '@wlisfes/chat-web-base-schema/nacos'
import { createMysqlOptions, DataBaseService } from '@wlisfes/chat-web-base-schema/database'
import * as SrmSchema from '@wlisfes/chat-web-base-schema/chat-web-srm-mysql'
import { CHANNEL_MYSQL_CONFIG_KEY } from '@/database/database.constants'

const entities = [
    SrmSchema.TbSrmRoute,
    SrmSchema.TbSrmRouteApp,
    SrmSchema.TbSrmRouteRule,
    SrmSchema.TbSrmRouteChannel,
    SrmSchema.TbSrmChannel
]

@Global()
@Module({
    imports: [
        TypeOrmModule.forRootAsync({
            imports: [ConfigModule],
            inject: [ConfigService, NacosService],
            useFactory: async (configService: ConfigService, nacosService: NacosService) => {
                await nacosService.loadConfig()
                const configured = configService.get<Record<string, unknown>>(CHANNEL_MYSQL_CONFIG_KEY)
                if (configured && typeof configured.database !== 'string' && typeof configured.name === 'string') {
                    configService.set(CHANNEL_MYSQL_CONFIG_KEY, { ...configured, database: configured.name })
                }
                return createMysqlOptions(configService, {
                    configKey: CHANNEL_MYSQL_CONFIG_KEY,
                    entities,
                    decimalNumbers: true
                })
            }
        }),
        TypeOrmModule.forFeature(entities)
    ],
    providers: [DataBaseService],
    exports: [TypeOrmModule, DataBaseService]
})
export class DatabaseModule {}
