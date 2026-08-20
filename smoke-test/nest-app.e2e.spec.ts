import 'reflect-metadata';
import { Controller, Get, INestApplication, Injectable, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PaginationModule } from '../src/pagination.module';
import { PaginationService } from '../src/pagination.service';
import { PaginationQuery, PaginationQueryDto } from '../src/query';

// Exercises the package the way a REAL consumer would: through NestJS's
// actual dependency injection container and a real HTTP request pipeline -
// not `new PaginationService()` and not calling the decorator's factory
// function directly (which is what the mocked unit tests and the DB smoke
// tests do). This is the one path none of that other testing covers.
//
// In particular: PaginationService has NO @Injectable() decorator. This
// test's whole purpose is to find out whether that actually breaks
// constructor injection via PaginationModule in a real Nest app, since none
// of our other tests go through Nest's DI container at all.

@Injectable()
class FakeRepo {
  private rows = [
    { id: 1, name: 'alice' },
    { id: 2, name: 'bob' },
    { id: 3, name: 'carol' },
  ];
  metadata = {
    columns: [{ propertyName: 'id' }, { propertyName: 'name' }, { propertyName: 'createdAt' }],
    primaryColumns: [{ propertyName: 'id' }],
    findRelationWithPropertyPath: () => undefined,
  };
  createQueryBuilder() {
    const rows = this.rows;
    let skipN = 0;
    let takeN = rows.length;
    const qb: any = {
      expressionMap: { aliases: [{ name: 'entity' }] },
      select: () => qb,
      andWhere: () => qb,
      orderBy: () => qb,
      leftJoin: () => qb,
      leftJoinAndSelect: () => qb,
      setParameters: () => qb,
      skip: (n: number) => {
        skipN = n;
        return qb;
      },
      take: (n: number) => {
        takeN = n;
        return qb;
      },
      getManyAndCount: async () => [rows.slice(skipN, skipN + takeN), rows.length],
    };
    return qb;
  }
}

@Controller('items')
class ItemsController {
  // Constructor-injected, exactly how a real consumer would use it - this
  // is what actually tests whether Nest's DI container can resolve
  // PaginationService without @Injectable() on it.
  constructor(
    private readonly paginationService: PaginationService,
    private readonly repo: FakeRepo,
  ) {}

  @Get()
  async list(@PaginationQuery() query: PaginationQueryDto) {
    return this.paginationService.applyPaginationAndFilters(
      this.repo as any,
      [],
      {},
      [],
      query.toQueryOptions(),
      ['name'],
      query.toSortOptions() ?? { field: 'createdAt', order: 'DESC' },
    );
  }
}

@Module({
  imports: [PaginationModule],
  controllers: [ItemsController],
  providers: [FakeRepo],
})
class TestAppModule {}

describe('Real NestJS app integration (DI + HTTP), not mocked instantiation', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [TestAppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('resolves PaginationService via constructor injection with no @Injectable() decorator', () => {
    // If this whole describe block ran at all (beforeAll didn't throw),
    // Nest's DI container successfully resolved PaginationService into
    // ItemsController's constructor - this assertion just makes that
    // explicit in a passing test rather than an implicit side effect.
    expect(app).toBeDefined();
  });

  it('a real HTTP GET request through the full pipeline returns paginated data', async () => {
    const res = await request(app.getHttpServer()).get('/items?page=1&limit=2').expect(200);
    expect(res.body.docs).toHaveLength(2);
    expect(res.body.meta.total).toBe(3);
  });

  it('the @PaginationQuery() decorator rejects an invalid query param with 400, over real HTTP', async () => {
    const res = await request(app.getHttpServer()).get('/items?page=-1').expect(400);
    expect(res.body.message).toBeDefined();
  });

  it('defaults are applied over real HTTP when no query params are given', async () => {
    const res = await request(app.getHttpServer()).get('/items').expect(200);
    expect(res.body.meta.page).toBe(1);
    expect(res.body.meta.limit).toBe(10);
  });
});
