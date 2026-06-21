import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { PlantModelDto } from './map-loader/opentcs-xml.parser';

@Injectable()
export class KernelApiService {
  private readonly logger = new Logger(KernelApiService.name);
  private readonly baseUrl: string;

  constructor() {
    this.baseUrl = process.env.OPENTCS_KERNEL_URL ?? 'http://localhost:55200';
  }

  async isReachable(): Promise<boolean> {
    try {
      await axios.get(`${this.baseUrl}/v1/kernel/version`, { timeout: 3_000 });
      return true;
    } catch {
      return false;
    }
  }

  async putPlantModel(model: PlantModelDto): Promise<void> {
    await axios.put(`${this.baseUrl}/v1/plantModel`, model, {
      headers: { 'Content-Type': 'application/json' },
    });
    this.logger.log(`Plant model "${model.name}" loaded into kernel`);
  }

  async getPlantModelName(): Promise<string | null> {
    try {
      const res = await axios.get<{ name: string }>(
        `${this.baseUrl}/v1/plantModel`,
      );
      return res.data.name;
    } catch {
      return null;
    }
  }

  async getPlantModel(): Promise<unknown | null> {
    try {
      const res = await axios.get(`${this.baseUrl}/v1/plantModel`, {
        timeout: 10_000,
      });
      return res.data;
    } catch {
      return null;
    }
  }

  async getVehicles(): Promise<Array<{ name: string }>> {
    const res = await axios.get<Array<{ name: string }>>(
      `${this.baseUrl}/v1/vehicles`,
      { timeout: 3_000 },
    );
    return res.data;
  }

  async getKernelState(): Promise<'MODELLING' | 'OPERATING' | null> {
    try {
      const res = await axios.get<{ state: string }>(
        `${this.baseUrl}/v1/kernel`,
        { timeout: 3_000 },
      );
      const s = res.data?.state;
      if (s === 'MODELLING' || s === 'OPERATING') return s;
      return null;
    } catch {
      return null;
    }
  }

  async setKernelState(state: 'MODELLING' | 'OPERATING'): Promise<void> {
    await axios.put(
      `${this.baseUrl}/v1/kernel/state?newValue=${state}`,
      null,
      { timeout: 10_000 },
    );
  }
}
