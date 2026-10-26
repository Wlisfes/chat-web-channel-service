import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { RouteCacheService } from '@/modules/dispatch/dispatch.cache'
import { DispatchService } from '@/modules/dispatch/dispatch.service'
import * as SrmSchema from '@wlisfes/chat-web-base-schema/chat-web-srm-mysql'

/** 短信选路模块：只消费队列，不提供接口。选路配置缓存在内存，按 SRM 变更广播和定时校对刷新。 */
@Module({
    imports: [
        TypeOrmModule.forFeature([
            SrmSchema.TbSrmRoute,
            SrmSchema.TbSrmRouteApp,
            SrmSchema.TbSrmRouteRule,
            SrmSchema.TbSrmRouteChannel,
            SrmSchema.TbSrmChannel
        ])
    ],
    providers: [RouteCacheService, DispatchService]
})
export class DispatchModule {}
