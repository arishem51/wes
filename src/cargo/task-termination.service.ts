import { Injectable, Logger } from '@nestjs/common';
import { TransportOrderService } from '../opentcs/transport-order.service';
import { VehicleStateStore } from '../opentcs/vehicle-state.store';
import {
  TaskStatus,
  TransportTaskEntity,
} from './entities/transport-task.entity';
import { TransportTaskStateMachine } from './domain/transport-task.state-machine';
import {
  TransportTaskService,
  StatusChangeLog,
} from './transport-task.service';

const STATUSES_WITH_A_VEHICLE_ON_AN_ORDER: readonly TaskStatus[] = [
  TaskStatus.PICKING_UP,
  TaskStatus.DELIVERING,
];

@Injectable()
export class TaskTerminationService {
  private readonly logger = new Logger(TaskTerminationService.name);

  constructor(
    private readonly transportOrders: TransportOrderService,
    private readonly vehicleStore: VehicleStateStore,
    private readonly transportTask: TransportTaskService,
  ) {}

  /**
   * Fail-closed: if the kernel can't confirm an in-flight order was actually withdrawn (kernel
   * unreachable/timeout — anything other than "the order was already gone"), this throws and
   * `task.status` is left untouched, rather than recording FAILED/CANCELLED over a load the
   * vehicle might still be carrying out. The caller sees a clear error and can retry once the
   * kernel is reachable again.
   */
  async terminate(
    task: TransportTaskEntity,
    to: TaskStatus,
    log: StatusChangeLog,
  ): Promise<void> {
    await this.withdrawUnfinishedOrders(task);

    if (!TransportTaskStateMachine.canTransition(task.status, to)) {
      this.logger.debug(
        `Task ${task.id} is already ${task.status} — leaving it as it is`,
      );
      return;
    }
    await this.transportTask.changeStatus(task, to, log);
  }

  private async withdrawUnfinishedOrders(
    task: TransportTaskEntity,
  ): Promise<void> {
    for (const orderName of this.unfinishedOrderNames(task)) {
      await this.transportOrders.cancel(orderName);
      this.logger.log(`Task ${task.id}: withdrew ${orderName}`);
    }
  }

  private unfinishedOrderNames(task: TransportTaskEntity): string[] {
    const metadata = task.metadata;
    const orderTheVehicleIsOn = this.orderTheVehicleIsOn(task);
    const latestOrderRecordedOnTheTask =
      metadata?.dropoffOrderName ??
      metadata?.approachOrderName ??
      metadata?.pickupOrderName;

    return [
      ...new Set(
        [orderTheVehicleIsOn, latestOrderRecordedOnTheTask].filter(
          (name): name is string => !!name,
        ),
      ),
    ];
  }

  private orderTheVehicleIsOn(task: TransportTaskEntity): string | null {
    const vehicleName = task.metadata?.assignedVehicleName;
    if (!vehicleName) return null;
    if (!STATUSES_WITH_A_VEHICLE_ON_AN_ORDER.includes(task.status)) return null;
    return this.vehicleStore.get(vehicleName)?.transportOrder ?? null;
  }
}
