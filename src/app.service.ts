import { Injectable, ServiceUnavailableException } from '@nestjs/common'
import * as HealthDto from '@/health/dto/health.dto'
import { HealthService } from '@/health/health.service'

@Injectable()
export class AppService {
    constructor(private readonly healthService: HealthService) {}

    /** 选路服务信息。 */
    public async httpBaseChannelResolverService(): Promise<string> {
        return 'Chat Web Channel Service'
    }

    /** 选路服务存活状态。 */
    public async httpBaseChannelLiveHealth(): Promise<HealthDto.ServiceLivenessResponseDto> {
        return this.healthService.getLiveness()
    }

    /** 选路服务就绪状态。 */
    public async httpBaseChannelReadyHealth(): Promise<HealthDto.ServiceReadinessResponseDto> {
        const result = await this.healthService.getReadiness()
        if (result.status !== 'UP') {
            throw new ServiceUnavailableException({ message: '选路服务尚未就绪', data: result })
        }
        return result
    }
}
