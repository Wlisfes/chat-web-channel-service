import { Get } from '@nestjs/common'
import { Public } from '@wlisfes/chat-web-base-schema/auth'
import { ApiServiceDecorator, ApifoxController } from '@wlisfes/chat-web-base-schema/decorator'
import { PreserveHttpStatus } from '@wlisfes/chat-web-base-schema/filters'
import { AppService } from '@/app.service'
import * as HealthDto from '@/health/dto/health.dto'

@ApifoxController('选路服务-运行状态')
export class AppController {
    constructor(private readonly appService: AppService) {}

    @Public()
    @ApiServiceDecorator(Get(), {
        operation: { summary: '查看选路服务信息' },
        response: { type: String, description: '选路服务名称' }
    })
    public async httpBaseChannelResolverService(): Promise<string> {
        return this.appService.httpBaseChannelResolverService()
    }

    @Public()
    @ApiServiceDecorator(Get('health/live'), {
        operation: { summary: '选路服务存活检查' },
        response: { type: HealthDto.ServiceLivenessResponseDto, description: '进程正常时返回 UP' }
    })
    public async httpBaseChannelLiveHealth(): Promise<HealthDto.ServiceLivenessResponseDto> {
        return this.appService.httpBaseChannelLiveHealth()
    }

    @Public()
    @ApiServiceDecorator(Get(['health', 'health/ready']), {
        operation: { summary: '选路服务就绪检查' },
        response: { type: HealthDto.ServiceReadinessResponseDto, description: '数据库、Redis 与鉴权配置状态' }
    })
    @PreserveHttpStatus()
    public async httpBaseChannelReadyHealth(): Promise<HealthDto.ServiceReadinessResponseDto> {
        return this.appService.httpBaseChannelReadyHealth()
    }
}
