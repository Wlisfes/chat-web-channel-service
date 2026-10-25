import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { DispatchService } from '@/modules/dispatch/dispatch.service'
import * as SrmSchema from '@wlisfes/chat-web-base-schema/chat-web-srm-mysql'

/** 短信选路模块：只消费队列，不提供接口。 */
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
    providers: [DispatchService]
})
export class DispatchModule {}
