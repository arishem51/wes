import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  TransportTaskEntity,
  TaskStatus,
} from './entities/transport-task.entity';
import { KernelApiService } from '../opentcs/kernel-api.service';
import { VehicleStateStore } from '../opentcs/vehicle-state.store';
import { TransportTaskService } from './transport-task.service';
import {
  FMS_EVENTS,
  FmsTransportOrderFinishedEvent,
  TaskLeg,
} from './domain/events';

const LIVE_STATUSES = [TaskStatus.PICKING_UP, TaskStatus.DELIVERING];

/**
 * Level-triggered backstop for the transport-order SSE stream, mirroring the
 * vehicle-state heartbeat (see KernelEventListenerService). If a "TO FINISHED"
 * frame is lost, the saga never advances TO1→TO2→TO3 and the task stalls in
 * PICKING_UP/DELIVERING forever. Each dispatch cycle we recompute the expected
 * leg from the task's own state and confirm it against the kernel.
 *
 * Cheap by construction: the vehicle snapshot already carries the order each
 * vehicle is on, so we only fetch an order (by name) when the vehicle has moved
 * off the leg we expected — never the unbounded /transportOrders list.
 */
@Injectable()
export class LegReconcileService {
  private readonly logger = new Logger(LegReconcileService.name);

  constructor(
    @InjectRepository(TransportTaskEntity)
    private readonly taskRepo: Repository<TransportTaskEntity>,
    private readonly vehicleStore: VehicleStateStore,
    private readonly kernelApi: KernelApiService,
    private readonly transportTask: TransportTaskService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async run(): Promise<void> {
    const tasks = await this.taskRepo.find({
      where: { status: In(LIVE_STATUSES) },
    });
    for (const task of tasks) {
      try {
        await this.reconcileTask(task);
      } catch (err) {
        this.logger.warn(
          `Leg reconcile failed for task ${task.id}: ${(err as Error).message}`,
        );
      }
    }
  }

  private async reconcileTask(task: TransportTaskEntity): Promise<void> {
    const expected = this.expectedLeg(task);
    if (!expected) return;

    const vehicleName = task.metadata?.assignedVehicleName;
    const onOrder = vehicleName
      ? this.vehicleStore.get(vehicleName)?.transportOrder
      : undefined;
    // Vehicle still processing the leg we expect → it is running; skip the fetch.
    if (onOrder === expected.orderName) return;

    // The vehicle has moved off the expected order — confirm its state directly.
    // The kernel is authoritative, so a transient snapshot lag never re-fires: a
    // still-running order reads BEING_PROCESSED and we simply wait for a later tick.
    const state = await this.kernelApi.getTransportOrderState(
      expected.orderName,
    );
    if (state === 'FINISHED') {
      this.logger.warn(
        `Leg reconcile: task ${task.id} ${expected.leg} order ${expected.orderName} FINISHED but unadvanced — re-firing`,
      );
      // Idempotent: the saga bails if the next leg already exists.
      this.eventEmitter.emit(
        FMS_EVENTS.TRANSPORT_ORDER_FINISHED,
        new FmsTransportOrderFinishedEvent(
          expected.orderName,
          task.id,
          expected.leg,
        ),
      );
    } else if (state === 'FAILED' || state === 'UNROUTABLE') {
      this.logger.warn(
        `Leg reconcile: task ${task.id} ${expected.leg} order ${state} — failing task`,
      );
      await this.transportTask.changeStatus(task, TaskStatus.FAILED, {
        trigger: 'LEG_RECONCILE',
        reason: `${expected.leg} order ${state}`,
      });
    }
    // RAW/DISPATCHABLE/BEING_PROCESSED/WITHDRAWN/null → not a settled outcome
    // yet; leave the task alone and re-check next cycle.
  }

  /**
   * The leg the task is currently waiting on, derived from its status + which
   * order names it has recorded — the same progression the saga drives.
   */
  private expectedLeg(
    task: TransportTaskEntity,
  ): { leg: TaskLeg; orderName: string } | null {
    const m = task.metadata;
    if (task.status === TaskStatus.PICKING_UP && m?.to1Name) {
      return { leg: 'PICKUP', orderName: m.to1Name };
    }
    if (task.status === TaskStatus.DELIVERING) {
      if (m?.to3Name) return { leg: 'DROPOFF', orderName: m.to3Name };
      if (m?.to2Name) return { leg: 'APPROACH', orderName: m.to2Name };
    }
    return null;
  }
}
