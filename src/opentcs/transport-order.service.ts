import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { KernelApiService } from './kernel-api.service';
import {
  buildOrderName,
  orderProperties,
  type CancelTransportOrder,
  type IssueTransportOrder,
} from './domain/transport-order';

@Injectable()
export class TransportOrderService {
  constructor(private readonly kernelApi: KernelApiService) {}

  async issue(order: IssueTransportOrder): Promise<string> {
    const orderName = buildOrderName(
      order.kind,
      order.vehicleName,
      order.aimedAt,
      randomUUID(),
    );
    await this.kernelApi.createTransportOrder(
      orderName,
      [...order.destinations],
      order.vehicleName,
      orderProperties(order.kind, order.taskId),
      { dispensable: !!order.dispensable },
    );
    return orderName;
  }

  async cancel(
    orderName: string,
    options: CancelTransportOrder = {},
  ): Promise<void> {
    await this.kernelApi.withdrawTransportOrder(orderName, !!options.immediate);
  }
}
