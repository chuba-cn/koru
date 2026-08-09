import { Controller, Get, Inject } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { ErrorResponseDto } from '../common/api.dto';
import { PAYMENT_GATEWAY, type PaymentGateway } from '../payments/gateway/payment-gateway';
import { BankListDto } from './settlement-account.dto';

@ApiTags('banks')
@Controller('banks')
@ApiUnauthorizedResponse({ description: 'No active session', type: ErrorResponseDto })
export class BankController {
  constructor(@Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway) {}

  @Get()
  @ApiOperation({ summary: 'The Nigerian bank directory, for a settlement account bank picker' })
  @ApiOkResponse({ type: BankListDto })
  list() {
    return this.gateway.listBanks();
  }
}
