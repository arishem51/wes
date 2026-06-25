import { ServiceUnavailableException } from '@nestjs/common';
import { AxiosError } from 'axios';
import { KernelApiService } from './kernel-api.service';

export async function savePlantModel(
  kernelApi: KernelApiService,
  model: unknown,
): Promise<void> {
  try {
    await kernelApi.putRawPlantModel(model);
  } catch (err) {
    const axiosErr = err as AxiosError;
    const status = axiosErr.response?.status;
    const msg =
      status === 400 || status === 409
        ? 'Kernel đang ở chế độ Vận hành, không thể cập nhật bản đồ. Hãy chuyển sang chế độ Thiết kế trước.'
        : `Không thể kết nối kernel: ${axiosErr.message}`;
    throw new ServiceUnavailableException(msg);
  }
}
