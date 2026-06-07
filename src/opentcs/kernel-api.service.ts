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
}
