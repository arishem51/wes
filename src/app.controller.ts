import { Controller, Get, Header, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @Header('Content-Type', 'text/html')
  getHome(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>WES FMS</title>
  <style>
    body { font-family: sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f5f5f5; }
    button { padding: 14px 28px; font-size: 16px; background: #1976d2; color: #fff; border: none; border-radius: 6px; cursor: pointer; }
    button:hover { background: #1565c0; }
    button:disabled { background: #90caf9; cursor: not-allowed; }
    #status { margin-top: 16px; font-size: 14px; color: #333; min-height: 20px; }
  </style>
</head>
<body>
  <h2>WES Fleet Management</h2>
  <button id="btn" onclick="createOrder()">Create Transport Order — v01 → Point 0004</button>
  <div id="status"></div>
  <script>
    async function createOrder() {
      const btn = document.getElementById('btn');
      const status = document.getElementById('status');
      btn.disabled = true;
      status.textContent = 'Sending...';
      try {
        const res = await fetch('/transport-order', { method: 'POST' });
        const data = await res.json();
        status.textContent = res.ok
          ? 'Created: ' + JSON.stringify(data.name ?? data)
          : 'Error: ' + (data.message ?? res.status);
      } catch (e) {
        status.textContent = 'Error: ' + e.message;
      } finally {
        btn.disabled = false;
      }
    }
  </script>
</body>
</html>`;
  }

  @Post('transport-order')
  async createTransportOrder(@Res() res: Response) {
    const result = await this.appService.createTransportOrder();
    res.status(result.status).json(result.body);
  }
}
