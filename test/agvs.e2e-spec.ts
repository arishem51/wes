import { Test, TestingModule } from '@nestjs/testing';
import {
  ExecutionContext,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import { AgvsController } from '../src/agvs/agvs.controller';
import { AgvsService } from '../src/agvs/agvs.service';
import { AgvEntity } from '../src/agvs/entities/agv.entity';
import { KernelApiService } from '../src/opentcs/kernel-api.service';
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../src/auth/guards/roles.guard';

const makeAgv = (overrides: Partial<AgvEntity> = {}): AgvEntity => ({
  id: 'agv-1',
  code: 'AGV-001',
  name: 'AGV 1',
  model: null,
  manufacturer: null,
  serialNumber: null,
  initialPosition: null,
  isDispatchEnabled: true,
  isIgnored: false,
  operationalBatteryThreshold: 20,
  chargingBatteryThreshold: 10,
  config: {},
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  createdById: 'user-1',
  ...overrides,
});

interface RequestWithUser {
  user?: { sub: string; roles: string[] };
}

class AllowAllGuard {
  canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<RequestWithUser>();
    req.user = { sub: 'user-1', roles: ['admin'] };
    return true;
  }
}

interface AgvBody {
  id: string;
  name: string;
  operationalBatteryThreshold: number;
}

interface AgvListBody {
  total: number;
  page: number;
  limit: number;
  agvs: AgvBody[];
}

describe('AgvsController (e2e)', () => {
  let app: INestApplication<App>;
  let repo: {
    find: jest.Mock;
    findOne: jest.Mock;
    findAndCount: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    remove: jest.Mock;
  };
  let kernelApi: { getVehicles: jest.Mock };

  beforeEach(async () => {
    repo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
      findAndCount: jest.fn().mockResolvedValue([[], 0]),
      create: jest.fn(),
      save: jest.fn(),
      remove: jest.fn(),
    };
    kernelApi = { getVehicles: jest.fn().mockResolvedValue([]) };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [AgvsController],
      providers: [
        AgvsService,
        { provide: getRepositoryToken(AgvEntity), useValue: repo },
        { provide: KernelApiService, useValue: kernelApi },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useClass(AllowAllGuard)
      .overrideGuard(RolesGuard)
      .useClass(AllowAllGuard)
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: false,
      }),
    );
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('GET /agvs', () => {
    it('returns a paginated list', async () => {
      const agv = makeAgv();
      repo.findAndCount.mockResolvedValue([[agv], 1]);

      const res = await request(app.getHttpServer())
        .get('/agvs')
        .query({ page: 1, limit: 10 })
        .expect(200);

      const body = res.body as AgvListBody;
      expect(body.total).toBe(1);
      expect(body.page).toBe(1);
      expect(body.limit).toBe(10);
      expect(body.agvs[0].id).toBe(agv.id);
      expect(repo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 10 }),
      );
    });

    it('applies the search filter from the query string', async () => {
      await request(app.getHttpServer())
        .get('/agvs')
        .query({ search: 'AGV-001' })
        .expect(200);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
      const callArg: { where?: unknown[] } = repo.findAndCount.mock.calls[0][0];
      expect(callArg.where).toHaveLength(3);
    });
  });

  describe('GET /agvs/:id', () => {
    it('returns AGV details when found', async () => {
      const agv = makeAgv();
      repo.findOne.mockResolvedValue(agv);

      const res = await request(app.getHttpServer())
        .get(`/agvs/${agv.id}`)
        .expect(200);

      const body = res.body as AgvBody;
      expect(body.id).toBe(agv.id);
      expect(body.operationalBatteryThreshold).toBe(20);
    });

    it('returns 404 when AGV does not exist', async () => {
      repo.findOne.mockResolvedValue(null);

      await request(app.getHttpServer()).get('/agvs/missing').expect(404);
    });
  });

  describe('PATCH /agvs/:id', () => {
    it('updates AGV details and thresholds', async () => {
      const agv = makeAgv();
      repo.findOne.mockResolvedValue(agv);
      repo.save.mockImplementation((entity) => Promise.resolve(entity));

      const res = await request(app.getHttpServer())
        .patch(`/agvs/${agv.id}`)
        .send({ name: 'AGV Renamed', operationalBatteryThreshold: 35 })
        .expect(200);

      const body = res.body as AgvBody;
      expect(body.name).toBe('AGV Renamed');
      expect(body.operationalBatteryThreshold).toBe(35);
    });

    it('returns 400 when threshold is out of range', async () => {
      const agv = makeAgv();
      repo.findOne.mockResolvedValue(agv);

      await request(app.getHttpServer())
        .patch(`/agvs/${agv.id}`)
        .send({ operationalBatteryThreshold: 150 })
        .expect(400);
    });

    it('returns 404 when AGV does not exist', async () => {
      repo.findOne.mockResolvedValue(null);

      await request(app.getHttpServer())
        .patch('/agvs/missing')
        .send({ name: 'X' })
        .expect(404);
    });
  });

  describe('DELETE /agvs/:id', () => {
    it('removes the AGV', async () => {
      const agv = makeAgv();
      repo.findOne.mockResolvedValue(agv);

      await request(app.getHttpServer()).delete(`/agvs/${agv.id}`).expect(200);

      expect(repo.remove).toHaveBeenCalledWith(agv);
    });
  });
});
