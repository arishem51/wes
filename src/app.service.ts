import { Injectable } from '@nestjs/common';

const KERNEL_URL = 'http://localhost:55200/v1';

@Injectable()
export class AppService {
  async createTransportOrder(): Promise<{ status: number; body: unknown }> {
    const name = `TO-v01-${Date.now()}`;
    const url = `${KERNEL_URL}/transportOrders/${name}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        intendedVehicle: 'v01',
        destinations: [
          {
            locationName: '0001',
            operation: 'MOVE',
          },
        ],
      }),
    });

    await response.json().catch(() => ({ message: 'No body' }));
    return { status: response.status, body: {} };
  }
}
