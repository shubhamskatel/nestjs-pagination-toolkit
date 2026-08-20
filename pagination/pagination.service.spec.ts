import {
  Brackets,
  Not,
  MoreThan,
  In,
  IsNull,
  LessThan,
  LessThanOrEqual,
  MoreThanOrEqual,
  Between,
  Like,
  ILike,
  ArrayContains,
  ArrayContainedBy,
  ArrayOverlap,
  Raw,
  And,
  Or,
  Equal,
  FindOperator,
} from 'typeorm';
import { PaginationService } from './pagination.service';

// ---------------------------------------------------------------------------
// Helpers to build a realistic mock TypeORM QueryBuilder / Repository chain.
// ---------------------------------------------------------------------------

/**
 * Pulls the `Brackets` instance out of a mocked `andWhere`/`orWhere` call so
 * its private `whereFactory` callback can be invoked manually with a fake
 * inner query builder - mirroring what TypeORM does internally when it
 * actually renders the SQL.
 */
function extractBracketsArg(mockFn: jest.Mock): Brackets | undefined {
  const call = mockFn.mock.calls.find((c: any[]) => c[0] instanceof Brackets);
  return call?.[0];
}

function createInnerQbMock() {
  return {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orWhere: jest.fn().mockReturnThis(),
  };
}

function createMockQueryBuilder() {
  const qb: any = {
    expressionMap: { aliases: [{ name: 'entity' }] },
  };
  qb.select = jest.fn().mockReturnThis();
  qb.andWhere = jest.fn().mockReturnThis();
  qb.orWhere = jest.fn().mockReturnThis();
  qb.orderBy = jest.fn().mockReturnThis();
  qb.leftJoinAndSelect = jest.fn().mockImplementation((_path: string, alias: string) => {
    qb.expressionMap.aliases.push({ name: alias });
    return qb;
  });
  qb.setParameters = jest.fn().mockReturnThis();
  qb.setParameter = jest.fn().mockReturnThis();
  qb.skip = jest.fn().mockReturnThis();
  qb.take = jest.fn().mockReturnThis();
  qb.groupBy = jest.fn().mockReturnThis();
  qb.where = jest.fn().mockReturnThis();
  qb.getManyAndCount = jest.fn();
  return qb;
}

function createMockRepository(queryBuilder: any, opts?: { columns?: string[] }) {
  const columns = opts?.columns ?? [
    'id',
    'createdAt',
    'updatedAt',
    'name',
    'role',
    'orderType',
    'score',
    'amount',
    'code',
    'tags',
    'balance',
    'status',
  ];
  return {
    createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
    metadata: {
      columns: columns.map((propertyName) => ({ propertyName })),
      primaryColumns: [{ propertyName: 'id' }],
      findRelationWithPropertyPath: jest.fn().mockReturnValue(undefined),
    },
  } as any;
}

describe('PaginationService', () => {
  let service: PaginationService;

  beforeEach(() => {
    service = new PaginationService();
    jest.clearAllMocks();
  });

  it('is defined', () => {
    expect(service).toBeDefined();
  });

  describe('applyPaginationAndFilters - basic pagination', () => {
    it('computes skip/take from page/limit and returns the correct PaginatedResult shape', async () => {
      const qb = createMockQueryBuilder();
      const repo = createMockRepository(qb);
      const fixtureDocs = [{ id: 1 }, { id: 2 }];
      qb.getManyAndCount.mockResolvedValue([fixtureDocs, 25]);

      const result = await service.applyPaginationAndFilters(
        repo,
        [],
        {},
        [],
        { page: 3, limit: 5 },
        [],
      );

      expect(qb.skip).toHaveBeenCalledWith(10); // (3-1)*5
      expect(qb.take).toHaveBeenCalledWith(5);
      expect(result).toEqual({
        docs: fixtureDocs,
        meta: {
          total: 25,
          page: 3,
          limit: 5,
          totalPages: 5,
        },
      });
    });

    it('defaults page=1 and limit=10 when not provided', async () => {
      const qb = createMockQueryBuilder();
      const repo = createMockRepository(qb);
      qb.getManyAndCount.mockResolvedValue([[], 0]);

      const result = await service.applyPaginationAndFilters(repo, [], {}, [], {}, []);

      expect(qb.skip).toHaveBeenCalledWith(0);
      expect(qb.take).toHaveBeenCalledWith(10);
      expect(result.meta).toEqual({ total: 0, page: 1, limit: 10, totalPages: 0 });
    });

    it('uses a customQueryBuilder instead of repository.createQueryBuilder when provided', async () => {
      const qb = createMockQueryBuilder();
      const repo = createMockRepository(createMockQueryBuilder()); // unused builder
      qb.getManyAndCount.mockResolvedValue([[{ id: 1 }], 1]);

      await service.applyPaginationAndFilters(
        repo,
        [],
        {},
        [],
        { page: 1, limit: 10 },
        [],
        undefined,
        qb,
      );

      expect(repo.createQueryBuilder).not.toHaveBeenCalled();
      expect(qb.getManyAndCount).toHaveBeenCalled();
    });
  });

  describe('applyPaginationAndFilters - getAllRecords', () => {
    it('skips skip/take calls entirely when getAllRecords is true', async () => {
      const qb = createMockQueryBuilder();
      const repo = createMockRepository(qb);
      qb.getManyAndCount.mockResolvedValue([[{ id: 1 }, { id: 2 }, { id: 3 }], 3]);

      const result = await service.applyPaginationAndFilters(
        repo,
        [],
        {},
        [],
        { page: 1, limit: 10 },
        [],
        undefined,
        undefined,
        true,
      );

      expect(qb.skip).not.toHaveBeenCalled();
      expect(qb.take).not.toHaveBeenCalled();
      expect(result.docs).toHaveLength(3);
    });
  });

  describe('applyPaginationAndFilters - dynamic where filters', () => {
    it('applies a plain equality filter', async () => {
      const qb = createMockQueryBuilder();
      const repo = createMockRepository(qb);
      qb.getManyAndCount.mockResolvedValue([[], 0]);

      await service.applyPaginationAndFilters(
        repo,
        [],
        { name: 'alice' },
        [],
        {},
        [],
      );

      expect(qb.andWhere).toHaveBeenCalledWith('entity.name = :name', {
        name: 'alice',
      });
    });

    it('applies IS NULL when the filter value is null or undefined', async () => {
      const qb = createMockQueryBuilder();
      const repo = createMockRepository(qb);
      qb.getManyAndCount.mockResolvedValue([[], 0]);

      await service.applyPaginationAndFilters(
        repo,
        [],
        { name: null, updatedAt: undefined },
        [],
        {},
        [],
      );

      expect(qb.andWhere).toHaveBeenCalledWith('entity.name IS NULL');
      expect(qb.andWhere).toHaveBeenCalledWith('entity.updatedAt IS NULL');
    });

    it('applies an IN (...) clause when the filter value is a plain array', async () => {
      const qb = createMockQueryBuilder();
      const repo = createMockRepository(qb);
      qb.getManyAndCount.mockResolvedValue([[], 0]);

      await service.applyPaginationAndFilters(
        repo,
        [],
        { name: ['alice', 'bob'] },
        [],
        {},
        [],
      );

      expect(qb.andWhere).toHaveBeenCalledWith('entity.name IN (:...name)', {
        name: ['alice', 'bob'],
      });
    });

    it('applies FIND_IN_SET for an opted-in "role" setColumns entry with a single value', async () => {
      const qb = createMockQueryBuilder();
      const repo = createMockRepository(qb);
      qb.getManyAndCount.mockResolvedValue([[], 0]);

      await service.applyPaginationAndFilters(
        repo,
        [],
        { role: 'ADMIN' },
        [],
        {},
        [],
        { field: 'createdAt', order: 'DESC' },
        undefined,
        false,
        { setColumns: ['role'] },
      );

      expect(qb.andWhere).toHaveBeenCalledWith('FIND_IN_SET(:role, entity.role)', {
        role: 'ADMIN',
      });
    });

    it('applies OR-joined FIND_IN_SET conditions for an opted-in "role" setColumns entry with an array value', async () => {
      const qb = createMockQueryBuilder();
      const repo = createMockRepository(qb);
      qb.getManyAndCount.mockResolvedValue([[], 0]);

      await service.applyPaginationAndFilters(
        repo,
        [],
        { role: ['ADMIN', 'USER'] },
        [],
        {},
        [],
        { field: 'createdAt', order: 'DESC' },
        undefined,
        false,
        { setColumns: ['role'] },
      );

      expect(qb.andWhere).toHaveBeenCalledWith(
        'FIND_IN_SET(:role_0, entity.role) OR FIND_IN_SET(:role_1, entity.role)',
        { role_0: 'ADMIN', role_1: 'USER' },
      );
    });

    it('treats "role" as a plain equality column when setColumns is not opted in (new default)', async () => {
      const qb = createMockQueryBuilder();
      const repo = createMockRepository(qb);
      qb.getManyAndCount.mockResolvedValue([[], 0]);

      await service.applyPaginationAndFilters(
        repo,
        [],
        { role: 'ADMIN' },
        [],
        {},
        [],
      );

      expect(qb.andWhere).toHaveBeenCalledWith('entity.role = :role', {
        role: 'ADMIN',
      });
    });

    it('applies a real TypeORM Not(...) FindOperator as a != clause', async () => {
      const qb = createMockQueryBuilder();
      const repo = createMockRepository(qb);
      qb.getManyAndCount.mockResolvedValue([[], 0]);

      await service.applyPaginationAndFilters(
        repo,
        [],
        { name: Not('bob') },
        [],
        {},
        [],
      );

      expect(qb.andWhere).toHaveBeenCalledWith('entity.name != :name', {
        name: 'bob',
      });
    });

    it('applies a real TypeORM MoreThan(...) FindOperator as a > clause', async () => {
      const qb = createMockQueryBuilder();
      const repo = createMockRepository(qb);
      qb.getManyAndCount.mockResolvedValue([[], 0]);

      await service.applyPaginationAndFilters(
        repo,
        [],
        { createdAt: MoreThan(100) },
        [],
        {},
        [],
      );

      expect(qb.andWhere).toHaveBeenCalledWith('entity.createdAt > :createdAt', {
        createdAt: 100,
      });
    });

    it('applies a real TypeORM Not([...]) FindOperator (array value) as a NOT IN (...) clause', async () => {
      const qb = createMockQueryBuilder();
      const repo = createMockRepository(qb);
      qb.getManyAndCount.mockResolvedValue([[], 0]);

      await service.applyPaginationAndFilters(
        repo,
        [],
        { name: Not(['a', 'b']) },
        [],
        {},
        [],
      );

      expect(qb.andWhere).toHaveBeenCalledWith(
        'entity.name NOT IN (:...name)',
        { name: ['a', 'b'] },
      );
    });

    it('applies a real TypeORM Not(null) FindOperator as an IS NOT NULL clause', async () => {
      const qb = createMockQueryBuilder();
      const repo = createMockRepository(qb);
      qb.getManyAndCount.mockResolvedValue([[], 0]);

      await service.applyPaginationAndFilters(
        repo,
        [],
        { name: Not(null) },
        [],
        {},
        [],
      );

      expect(qb.andWhere).toHaveBeenCalledWith('entity.name IS NOT NULL');
    });

    it('falls back to IS NULL / = for an unmatched top-level FindOperator type (e.g. Equal)', async () => {
      const qb = createMockQueryBuilder();
      const repo = createMockRepository(qb);
      qb.getManyAndCount.mockResolvedValue([[], 0]);

      await service.applyPaginationAndFilters(
        repo,
        [],
        { name: Equal('alice'), score: Equal(null) },
        [],
        {},
        [],
      );

      expect(qb.andWhere).toHaveBeenCalledWith('entity.name = :name', {
        name: 'alice',
      });
      expect(qb.andWhere).toHaveBeenCalledWith('entity.score IS NULL');
    });

    it('applies a real TypeORM In(...) FindOperator as an IN (...) clause', async () => {
      const qb = createMockQueryBuilder();
      const repo = createMockRepository(qb);
      qb.getManyAndCount.mockResolvedValue([[], 0]);

      await service.applyPaginationAndFilters(
        repo,
        [],
        { name: In(['a', 'b']) },
        [],
        {},
        [],
      );

      expect(qb.andWhere).toHaveBeenCalledWith('entity.name IN (:...name)', {
        name: ['a', 'b'],
      });
    });

    it('applies AND-joined FIND_IN_SET conditions for an opted-in "orderType" setColumnsAll entry with an array value, de-duplicating repeats', async () => {
      const qb = createMockQueryBuilder();
      const repo = createMockRepository(qb);
      qb.getManyAndCount.mockResolvedValue([[], 0]);

      await service.applyPaginationAndFilters(
        repo,
        [],
        { orderType: ['buy', 'sell', 'buy'] },
        [],
        {},
        [],
        { field: 'createdAt', order: 'DESC' },
        undefined,
        false,
        { setColumnsAll: ['orderType'] },
      );

      expect(qb.andWhere).toHaveBeenCalledWith(
        'FIND_IN_SET(:orderType_0, entity.orderType) AND FIND_IN_SET(:orderType_1, entity.orderType)',
        { orderType_0: 'buy', orderType_1: 'sell' },
      );
    });

    it('applies AND-joined FIND_IN_SET conditions for an opted-in "orderType" setColumnsAll entry with a comma-separated string value', async () => {
      const qb = createMockQueryBuilder();
      const repo = createMockRepository(qb);
      qb.getManyAndCount.mockResolvedValue([[], 0]);

      await service.applyPaginationAndFilters(
        repo,
        [],
        { orderType: 'buy, sell' },
        [],
        {},
        [],
        { field: 'createdAt', order: 'DESC' },
        undefined,
        false,
        { setColumnsAll: ['orderType'] },
      );

      expect(qb.andWhere).toHaveBeenCalledWith(
        'FIND_IN_SET(:orderType_0, entity.orderType) AND FIND_IN_SET(:orderType_1, entity.orderType)',
        { orderType_0: 'buy', orderType_1: 'sell' },
      );
    });

    it('skips the "orderType" filter entirely when opted into setColumnsAll and it resolves to no non-empty parts', async () => {
      const qb = createMockQueryBuilder();
      const repo = createMockRepository(qb);
      qb.getManyAndCount.mockResolvedValue([[], 0]);

      await service.applyPaginationAndFilters(
        repo,
        [],
        { orderType: '   ' },
        [],
        {},
        [],
        { field: 'createdAt', order: 'DESC' },
        undefined,
        false,
        { setColumnsAll: ['orderType'] },
      );

      const orderTypeCalls = qb.andWhere.mock.calls.filter(
        (c: any[]) => typeof c[0] === 'string' && c[0].includes('orderType'),
      );
      expect(orderTypeCalls).toHaveLength(0);
    });

    it('applies dot-notation nested relation filters against the relation alias', async () => {
      const qb = createMockQueryBuilder();
      const repo = createMockRepository(qb);
      (repo.metadata.findRelationWithPropertyPath as jest.Mock).mockImplementation(
        (path: string) =>
          path === 'offering.agent'
            ? { inverseEntityMetadata: { columns: [{ propertyName: 'uId' }] } }
            : undefined,
      );
      qb.getManyAndCount.mockResolvedValue([[], 0]);

      await service.applyPaginationAndFilters(
        repo,
        [],
        { 'offering.agent.uId': 'agent-1' },
        [],
        {},
        [],
      );

      expect(qb.andWhere).toHaveBeenCalledWith(
        'offering_agent.uId = :offering_agent_uId',
        { offering_agent_uId: 'agent-1' },
      );
    });
  });

  describe('applyPaginationAndFilters - additional FindOperator branches', () => {
    it('applies a real TypeORM LessThan(...) FindOperator as a < clause', async () => {
      const qb = createMockQueryBuilder();
      const repo = createMockRepository(qb);
      qb.getManyAndCount.mockResolvedValue([[], 0]);

      await service.applyPaginationAndFilters(
        repo,
        [],
        { createdAt: LessThan(50) },
        [],
        {},
        [],
      );

      expect(qb.andWhere).toHaveBeenCalledWith('entity.createdAt < :createdAt', {
        createdAt: 50,
      });
    });

    it('applies a real TypeORM LessThanOrEqual(...) FindOperator as a <= clause', async () => {
      const qb = createMockQueryBuilder();
      const repo = createMockRepository(qb);
      qb.getManyAndCount.mockResolvedValue([[], 0]);

      await service.applyPaginationAndFilters(
        repo,
        [],
        { createdAt: LessThanOrEqual(50) },
        [],
        {},
        [],
      );

      expect(qb.andWhere).toHaveBeenCalledWith(
        'entity.createdAt <= :createdAt',
        { createdAt: 50 },
      );
    });

    it('applies a real TypeORM MoreThanOrEqual(...) FindOperator as a >= clause', async () => {
      const qb = createMockQueryBuilder();
      const repo = createMockRepository(qb);
      qb.getManyAndCount.mockResolvedValue([[], 0]);

      await service.applyPaginationAndFilters(
        repo,
        [],
        { createdAt: MoreThanOrEqual(50) },
        [],
        {},
        [],
      );

      expect(qb.andWhere).toHaveBeenCalledWith(
        'entity.createdAt >= :createdAt',
        { createdAt: 50 },
      );
    });

    it('applies a real TypeORM Between(from, to) FindOperator as a BETWEEN clause', async () => {
      const qb = createMockQueryBuilder();
      const repo = createMockRepository(qb);
      qb.getManyAndCount.mockResolvedValue([[], 0]);

      await service.applyPaginationAndFilters(
        repo,
        [],
        { amount: Between(1, 9) },
        [],
        {},
        [],
      );

      expect(qb.andWhere).toHaveBeenCalledWith(
        'entity.amount BETWEEN :amount_from AND :amount_to',
        { amount_from: 1, amount_to: 9 },
      );
    });

    it('falls back to [undefined, undefined] for a "between" FindOperator whose resolved value is not an array', async () => {
      const qb = createMockQueryBuilder();
      const repo = createMockRepository(qb);
      qb.getManyAndCount.mockResolvedValue([[], 0]);

      // TypeORM's own Between(from, to) helper always produces an array value,
      // so this non-array-value path is only reachable via a directly
      // constructed FindOperator (still a real TypeORM class, not a mock).
      await service.applyPaginationAndFilters(
        repo,
        [],
        { amount: new FindOperator('between', 42) },
        [],
        {},
        [],
      );

      expect(qb.andWhere).toHaveBeenCalledWith(
        'entity.amount BETWEEN :amount_from AND :amount_to',
        { amount_from: undefined, amount_to: undefined },
      );
    });

    it('applies a real TypeORM Like(...) FindOperator as a LIKE clause', async () => {
      const qb = createMockQueryBuilder();
      const repo = createMockRepository(qb);
      qb.getManyAndCount.mockResolvedValue([[], 0]);

      await service.applyPaginationAndFilters(
        repo,
        [],
        { name: Like('%foo%') },
        [],
        {},
        [],
      );

      expect(qb.andWhere).toHaveBeenCalledWith('entity.name LIKE :name', {
        name: '%foo%',
      });
    });

    it('applies a real TypeORM ILike(...) FindOperator, lowercasing a string value', async () => {
      const qb = createMockQueryBuilder();
      const repo = createMockRepository(qb);
      qb.getManyAndCount.mockResolvedValue([[], 0]);

      await service.applyPaginationAndFilters(
        repo,
        [],
        { name: ILike('FOO') },
        [],
        {},
        [],
      );

      expect(qb.andWhere).toHaveBeenCalledWith(
        'LOWER(entity.name) LIKE :name_ilike',
        { name_ilike: 'foo' },
      );
    });

    it('applies a real TypeORM ILike(...) FindOperator, passing a non-string value through unchanged', async () => {
      const qb = createMockQueryBuilder();
      const repo = createMockRepository(qb);
      qb.getManyAndCount.mockResolvedValue([[], 0]);

      await service.applyPaginationAndFilters(
        repo,
        [],
        { code: ILike(123 as any) },
        [],
        {},
        [],
      );

      expect(qb.andWhere).toHaveBeenCalledWith(
        'LOWER(entity.code) LIKE :code_ilike',
        { code_ilike: 123 },
      );
    });

    it('applies a real TypeORM IsNull() FindOperator as an IS NULL clause', async () => {
      const qb = createMockQueryBuilder();
      const repo = createMockRepository(qb);
      qb.getManyAndCount.mockResolvedValue([[], 0]);

      await service.applyPaginationAndFilters(
        repo,
        [],
        { name: IsNull() },
        [],
        {},
        [],
      );

      expect(qb.andWhere).toHaveBeenCalledWith('entity.name IS NULL');
    });

    it('applies a real TypeORM ArrayContains(...) FindOperator as a @> clause', async () => {
      const qb = createMockQueryBuilder();
      const repo = createMockRepository(qb);
      qb.getManyAndCount.mockResolvedValue([[], 0]);

      await service.applyPaginationAndFilters(
        repo,
        [],
        { tags: ArrayContains(['tag1']) },
        [],
        {},
        [],
      );

      expect(qb.andWhere).toHaveBeenCalledWith('entity.tags @> :tags', {
        tags: ['tag1'],
      });
    });

    it('applies a real TypeORM ArrayContainedBy(...) FindOperator as a <@ clause', async () => {
      const qb = createMockQueryBuilder();
      const repo = createMockRepository(qb);
      qb.getManyAndCount.mockResolvedValue([[], 0]);

      await service.applyPaginationAndFilters(
        repo,
        [],
        { tags: ArrayContainedBy(['tag2']) },
        [],
        {},
        [],
      );

      expect(qb.andWhere).toHaveBeenCalledWith('entity.tags <@ :tags', {
        tags: ['tag2'],
      });
    });

    it('applies a real TypeORM ArrayOverlap(...) FindOperator as an && clause', async () => {
      const qb = createMockQueryBuilder();
      const repo = createMockRepository(qb);
      qb.getManyAndCount.mockResolvedValue([[], 0]);

      await service.applyPaginationAndFilters(
        repo,
        [],
        { tags: ArrayOverlap(['tag3']) },
        [],
        {},
        [],
      );

      expect(qb.andWhere).toHaveBeenCalledWith('entity.tags && :tags', {
        tags: ['tag3'],
      });
    });

    it('applies a real TypeORM Raw(...) FindOperator with a string value directly', async () => {
      const qb = createMockQueryBuilder();
      const repo = createMockRepository(qb);
      qb.getManyAndCount.mockResolvedValue([[], 0]);

      await service.applyPaginationAndFilters(
        repo,
        [],
        { name: Raw('custom_raw_condition') },
        [],
        {},
        [],
      );

      expect(qb.andWhere).toHaveBeenCalledWith('custom_raw_condition');
    });

    it('applies a directly-constructed "raw" FindOperator whose value is a function, invoking it with dbColumn', async () => {
      // TypeORM's public Raw(sqlGenerator) helper stores the generator function
      // separately as `_getSql`, NOT as `.value` (the FindOperator `value`
      // getter returns `_value`, which Raw() sets to `[]` in the
      // function-argument case). The service's function-branch for `raw`
      // reads `.value`, so it is only reachable via a directly constructed
      // FindOperator - still a real TypeORM class, not a mock/stub.
      const qb = createMockQueryBuilder();
      const repo = createMockRepository(qb);
      qb.getManyAndCount.mockResolvedValue([[], 0]);

      await service.applyPaginationAndFilters(
        repo,
        [],
        { balance: new FindOperator('raw', (col: string) => `${col} = 1`) },
        [],
        {},
        [],
      );

      expect(qb.andWhere).toHaveBeenCalledWith('entity.balance = 1');
    });

    it('falls back to an = comparison for a "raw" FindOperator whose value is neither a function nor a string', async () => {
      const qb = createMockQueryBuilder();
      const repo = createMockRepository(qb);
      qb.getManyAndCount.mockResolvedValue([[], 0]);

      await service.applyPaginationAndFilters(
        repo,
        [],
        { code: Raw(42 as any) },
        [],
        {},
        [],
      );

      expect(qb.andWhere).toHaveBeenCalledWith('entity.code = :code', {
        code: 42,
      });
    });
  });

  describe('applyPaginationAndFilters - and/or nested FindOperator branches', () => {
    it('recursively resolves a wide variety of nested FindOperator sub-types inside And(...), routing through andWhere', async () => {
      const qb = createMockQueryBuilder();
      const repo = createMockRepository(qb);
      qb.getManyAndCount.mockResolvedValue([[], 0]);

      await service.applyPaginationAndFilters(
        repo,
        [],
        {
          status: And(
            In(['a', 'b']),
            Not('x'),
            Not(null),
            LessThan(5),
            MoreThan(10),
            LessThanOrEqual(7),
            MoreThanOrEqual(3),
            Between(1, 9),
            Like('%foo%'),
            ILike('BAR'),
            IsNull(),
            ArrayContains(['tag1']),
            ArrayContainedBy(['tag2']),
            ArrayOverlap(['tag3']),
            Raw('raw_fragment'),
            'plainValue' as any,
          ),
        },
        [],
        {},
        [],
      );

      const brackets = extractBracketsArg(qb.andWhere);
      expect(brackets).toBeDefined();

      const innerQb = createInnerQbMock();
      (brackets as any).whereFactory(innerQb);

      expect(innerQb.andWhere).toHaveBeenCalledWith(
        'entity.status IN (:...status_and_0)',
        { status_and_0: ['a', 'b'] },
      );
      expect(innerQb.andWhere).toHaveBeenCalledWith(
        'entity.status != :status_and_1',
        { status_and_1: 'x' },
      );
      expect(innerQb.andWhere).toHaveBeenCalledWith('entity.status IS NOT NULL');
      expect(innerQb.andWhere).toHaveBeenCalledWith(
        'entity.status < :status_and_3',
        { status_and_3: 5 },
      );
      expect(innerQb.andWhere).toHaveBeenCalledWith(
        'entity.status > :status_and_4',
        { status_and_4: 10 },
      );
      expect(innerQb.andWhere).toHaveBeenCalledWith(
        'entity.status <= :status_and_5',
        { status_and_5: 7 },
      );
      expect(innerQb.andWhere).toHaveBeenCalledWith(
        'entity.status >= :status_and_6',
        { status_and_6: 3 },
      );
      expect(innerQb.andWhere).toHaveBeenCalledWith(
        'entity.status BETWEEN :status_and_7_from AND :status_and_7_to',
        { status_and_7_from: 1, status_and_7_to: 9 },
      );
      expect(innerQb.andWhere).toHaveBeenCalledWith(
        'entity.status LIKE :status_and_8',
        { status_and_8: '%foo%' },
      );
      expect(innerQb.andWhere).toHaveBeenCalledWith(
        'LOWER(entity.status) LIKE :status_and_9_ilike',
        { status_and_9_ilike: 'bar' },
      );
      expect(innerQb.andWhere).toHaveBeenCalledWith('entity.status IS NULL');
      expect(innerQb.andWhere).toHaveBeenCalledWith(
        'entity.status @> :status_and_11',
        { status_and_11: ['tag1'] },
      );
      expect(innerQb.andWhere).toHaveBeenCalledWith(
        'entity.status <@ :status_and_12',
        { status_and_12: ['tag2'] },
      );
      expect(innerQb.andWhere).toHaveBeenCalledWith(
        'entity.status && :status_and_13',
        { status_and_13: ['tag3'] },
      );
      expect(innerQb.andWhere).toHaveBeenCalledWith('raw_fragment');
      expect(innerQb.andWhere).toHaveBeenCalledWith(
        'entity.status = :status_and_15',
        { status_and_15: 'plainValue' },
      );
      expect(innerQb.orWhere).not.toHaveBeenCalled();
    });

    it('recursively resolves nested FindOperator sub-types inside Or(...), routing through orWhere', async () => {
      const qb = createMockQueryBuilder();
      const repo = createMockRepository(qb);
      qb.getManyAndCount.mockResolvedValue([[], 0]);

      await service.applyPaginationAndFilters(
        repo,
        [],
        {
          amount: Or(
            LessThan(5) as any,
            new FindOperator('raw', (col: string) => `${col} = 1`) as any,
            'plainVal' as any,
          ),
        },
        [],
        {},
        [],
      );

      const brackets = extractBracketsArg(qb.andWhere);
      expect(brackets).toBeDefined();

      const innerQb = createInnerQbMock();
      (brackets as any).whereFactory(innerQb);

      expect(innerQb.orWhere).toHaveBeenCalledWith(
        'entity.amount < :amount_or_0',
        { amount_or_0: 5 },
      );
      expect(innerQb.orWhere).toHaveBeenCalledWith('entity.amount = 1');
      expect(innerQb.orWhere).toHaveBeenCalledWith(
        'entity.amount = :amount_or_2',
        { amount_or_2: 'plainVal' },
      );
      expect(innerQb.andWhere).not.toHaveBeenCalled();
    });

    it('covers remaining nested And(...) sub-branches: Not(...) with an array value, a Raw(...) fallback, and an unmatched sub-type', async () => {
      const qb = createMockQueryBuilder();
      const repo = createMockRepository(qb);
      qb.getManyAndCount.mockResolvedValue([[], 0]);

      await service.applyPaginationAndFilters(
        repo,
        [],
        { status: And(Not(['a', 'b']) as any, Raw(42 as any) as any, Equal('zzz') as any) },
        [],
        {},
        [],
      );

      const brackets = extractBracketsArg(qb.andWhere);
      expect(brackets).toBeDefined();

      const innerQb = createInnerQbMock();
      (brackets as any).whereFactory(innerQb);

      expect(innerQb.andWhere).toHaveBeenCalledWith(
        'entity.status NOT IN (:...status_and_0)',
        { status_and_0: ['a', 'b'] },
      );
      // Raw(42): resolved value is neither a function nor a string -> falls
      // back to a plain = comparison (the nested "raw" fallback branch).
      expect(innerQb.andWhere).toHaveBeenCalledWith(
        'entity.status = :status_and_1',
        { status_and_1: 42 },
      );
      // Equal(...) is not one of the explicitly-handled nested sub-types ->
      // falls through to the final nested else (also a plain = comparison).
      expect(innerQb.andWhere).toHaveBeenCalledWith(
        'entity.status = :status_and_2',
        { status_and_2: 'zzz' },
      );
    });
  });

  describe('applyPaginationAndFilters - date filters', () => {
    it('applies startDate and endDate filters when provided in queryOptions', async () => {
      const qb = createMockQueryBuilder();
      const repo = createMockRepository(qb);
      qb.getManyAndCount.mockResolvedValue([[], 0]);

      await service.applyPaginationAndFilters(
        repo,
        [],
        {},
        [],
        { startDate: '2024-01-01', endDate: '2024-02-01' },
        [],
      );

      expect(qb.andWhere).toHaveBeenCalledWith('entity.createdAt >= :startDate', {
        startDate: '2024-01-01',
      });
      expect(qb.andWhere).toHaveBeenCalledWith('entity.createdAt <= :endDate', {
        endDate: '2024-02-01',
      });
    });

    it('applies dateRangeFilter BETWEEN clauses per entry', async () => {
      const qb = createMockQueryBuilder();
      const repo = createMockRepository(qb, {
        columns: ['id', 'createdAt', 'updatedAt', 'name', 'role', 'amount'],
      });
      qb.getManyAndCount.mockResolvedValue([[], 0]);

      await service.applyPaginationAndFilters(
        repo,
        [],
        {},
        [],
        {
          dateRangeFilter: [{ fieldName: 'amount', min: 10, max: 100 }],
        },
        [],
      );

      expect(qb.andWhere).toHaveBeenCalledWith(
        'entity.amount BETWEEN :min0 AND :max0',
        { min0: 10, max0: 100 },
      );
    });

    it('skips dateRangeFilter entries missing fieldName, min, or max', async () => {
      const qb = createMockQueryBuilder();
      const repo = createMockRepository(qb, {
        columns: ['id', 'createdAt', 'updatedAt', 'name', 'role', 'amount', 'score'],
      });
      qb.getManyAndCount.mockResolvedValue([[], 0]);

      await service.applyPaginationAndFilters(
        repo,
        [],
        {},
        [],
        {
          dateRangeFilter: [
            { fieldName: 'amount', min: 10, max: 100 }, // complete -> applied
            { fieldName: 'score', min: 5 }, // missing max -> skipped
            { min: 1, max: 2 }, // missing fieldName -> skipped
          ],
        },
        [],
      );

      const betweenCalls = qb.andWhere.mock.calls.filter(
        (c: any[]) => typeof c[0] === 'string' && c[0].includes('BETWEEN'),
      );
      expect(betweenCalls).toHaveLength(1);
      expect(betweenCalls[0]).toEqual([
        'entity.amount BETWEEN :min0 AND :max0',
        { min0: 10, max0: 100 },
      ]);
    });

    it('rejects a dateRangeFilter fieldName that is not a real entity column', async () => {
      const qb = createMockQueryBuilder();
      const repo = createMockRepository(qb);
      qb.getManyAndCount.mockResolvedValue([[], 0]);

      await expect(
        service.applyPaginationAndFilters(
          repo,
          [],
          {},
          [],
          {
            dateRangeFilter: [
              { fieldName: '1=1); DROP TABLE users; --', min: 1, max: 2 },
            ],
          },
          [],
        ),
      ).rejects.toThrow();

      const betweenCalls = qb.andWhere.mock.calls.filter(
        (c: any[]) => typeof c[0] === 'string' && c[0].includes('BETWEEN'),
      );
      expect(betweenCalls).toHaveLength(0);
    });
  });

  describe('applyPaginationAndFilters - search', () => {
    it('adds a Brackets andWhere clause when search and searchKeys are both provided', async () => {
      const qb = createMockQueryBuilder();
      const repo = createMockRepository(qb);
      qb.getManyAndCount.mockResolvedValue([[], 0]);

      await service.applyPaginationAndFilters(
        repo,
        [],
        {},
        [],
        { search: 'alice' },
        ['name', 'agent.email'],
      );

      const bracketsCall = qb.andWhere.mock.calls.find(
        (call: any[]) => call[0] instanceof Brackets,
      );
      expect(bracketsCall).toBeDefined();
    });

    it('does not add an extra andWhere for search when search is empty', async () => {
      const qb = createMockQueryBuilder();
      const repo = createMockRepository(qb);
      qb.getManyAndCount.mockResolvedValue([[], 0]);

      await service.applyPaginationAndFilters(
        repo,
        [],
        {},
        [],
        { search: '' },
        ['name'],
      );

      const bracketsCall = qb.andWhere.mock.calls.find(
        (call: any[]) => call[0] instanceof Brackets,
      );
      expect(bracketsCall).toBeUndefined();
    });

    it('does not add an extra andWhere for search when searchKeys is empty', async () => {
      const qb = createMockQueryBuilder();
      const repo = createMockRepository(qb);
      qb.getManyAndCount.mockResolvedValue([[], 0]);

      await service.applyPaginationAndFilters(
        repo,
        [],
        {},
        [],
        { search: 'alice' },
        [],
      );

      const bracketsCall = qb.andWhere.mock.calls.find(
        (call: any[]) => call[0] instanceof Brackets,
      );
      expect(bracketsCall).toBeUndefined();
    });

    it('builds a combined LOWER(CONCAT(firstName, lastName)) condition when search has >= 2 words and an alias group has both columns', async () => {
      const qb = createMockQueryBuilder();
      const repo = createMockRepository(qb);
      qb.getManyAndCount.mockResolvedValue([[], 0]);

      await service.applyPaginationAndFilters(
        repo,
        [],
        {},
        [],
        { search: 'John Doe' },
        ['profile.firstName', 'profile.lastName'],
      );

      const brackets = extractBracketsArg(qb.andWhere);
      expect(brackets).toBeDefined();

      const innerQb = createInnerQbMock();
      (brackets as any).whereFactory(innerQb);

      expect(innerQb.where).toHaveBeenCalledWith(
        expect.stringContaining(
          "LOWER(CONCAT(profile.firstName, ' ', profile.lastName)) LIKE :combined_full_name",
        ),
      );
      expect(qb.setParameters).toHaveBeenCalledWith(
        expect.objectContaining({ combined_full_name: '%john doe%' }),
      );
    });
  });

  describe('applyPaginationAndFilters - sorting', () => {
    it('sorts by an entity column prefixed with "entity."', async () => {
      const qb = createMockQueryBuilder();
      const repo = createMockRepository(qb);
      qb.getManyAndCount.mockResolvedValue([[], 0]);

      await service.applyPaginationAndFilters(repo, [], {}, [], {}, [], {
        field: 'name',
        order: 'ASC',
      });

      expect(qb.orderBy).toHaveBeenCalledWith('entity.name', 'ASC');
    });

    it('sorts by a non-entity-column alias directly (no "entity." prefix)', async () => {
      const qb = createMockQueryBuilder();
      const repo = createMockRepository(qb);
      qb.getManyAndCount.mockResolvedValue([[], 0]);

      await service.applyPaginationAndFilters(repo, [], {}, [], {}, [], {
        field: 'raisedFundsPercent',
        order: 'DESC',
      });

      expect(qb.orderBy).toHaveBeenCalledWith('raisedFundsPercent', 'DESC');
    });

    it('sorts by a raw SQL expression when sortOptions.expression is provided', async () => {
      const qb = createMockQueryBuilder();
      const repo = createMockRepository(qb);
      qb.getManyAndCount.mockResolvedValue([[], 0]);

      await service.applyPaginationAndFilters(repo, [], {}, [], {}, [], {
        expression: 'COALESCE(entity.amount, 0)',
        order: 'DESC',
      });

      expect(qb.orderBy).toHaveBeenCalledWith(
        'COALESCE(entity.amount, 0)',
        'DESC',
      );
    });

    it('defaults to entity.createdAt DESC when no sortOptions field/expression are usable', async () => {
      const qb = createMockQueryBuilder();
      const repo = createMockRepository(qb);
      qb.getManyAndCount.mockResolvedValue([[], 0]);

      // Passing an object with neither field nor expression triggers the final else branch.
      await service.applyPaginationAndFilters(
        repo,
        [],
        {},
        [],
        {},
        [],
        {} as any,
      );

      expect(qb.orderBy).toHaveBeenCalledWith('entity.createdAt', 'DESC');
    });
  });

  describe('applyPaginationAndFilters - relations', () => {
    it('joins a nested relation path and dedupes aliases already present', async () => {
      const qb = createMockQueryBuilder();
      // Pre-seed the alias list to simulate 'offering' already joined elsewhere.
      qb.expressionMap.aliases.push({ name: 'offering' });
      const repo = createMockRepository(qb);
      qb.getManyAndCount.mockResolvedValue([[], 0]);

      await service.applyPaginationAndFilters(
        repo,
        [],
        {},
        ['offering.agent'],
        {},
        [],
      );

      // 'offering' alias already existed -> only 'offering_agent' should be newly joined.
      const joinedAliases = qb.leftJoinAndSelect.mock.calls.map((c: any[]) => c[1]);
      expect(joinedAliases).toContain('offering_agent');
      expect(joinedAliases.filter((a: string) => a === 'offering')).toHaveLength(0);
    });

    it('does not call leftJoinAndSelect twice for the same relation across the two relation-processing passes', async () => {
      const qb = createMockQueryBuilder();
      const repo = createMockRepository(qb);
      qb.getManyAndCount.mockResolvedValue([[], 0]);

      await service.applyPaginationAndFilters(
        repo,
        [],
        {},
        ['offering'],
        {},
        [],
      );

      const offeringJoins = qb.leftJoinAndSelect.mock.calls.filter(
        (c: any[]) => c[1] === 'offering',
      );
      expect(offeringJoins).toHaveLength(1);
      expect(offeringJoins[0]).toEqual(['entity.offering', 'offering']);
    });
  });

  describe('applyPaginationAndFilters - select fields', () => {
    it('builds a select clause mapping entity columns and relation columns when selectFields is provided', async () => {
      const qb = createMockQueryBuilder();
      const repo = createMockRepository(qb);
      qb.getManyAndCount.mockResolvedValue([[], 0]);

      await service.applyPaginationAndFilters(
        repo,
        ['name', 'agent.uId'],
        {},
        [],
        {},
        [],
      );

      const selectArg = qb.select.mock.calls[0][0];
      expect(selectArg).toEqual(
        expect.arrayContaining(['entity.name', 'agent.uId', 'entity.id']),
      );
    });

    it('returns a single-part selectFields entry unchanged when it is not a known entity column (e.g. a computed alias)', async () => {
      const qb = createMockQueryBuilder();
      const repo = createMockRepository(qb);
      qb.getManyAndCount.mockResolvedValue([[], 0]);

      await service.applyPaginationAndFilters(
        repo,
        ['raisedFundsPercent'],
        {},
        [],
        {},
        [],
      );

      const selectArg = qb.select.mock.calls[0][0];
      expect(selectArg).toEqual(
        expect.arrayContaining(['raisedFundsPercent']),
      );
    });

    it('selects all entity columns plus relation columns via findRelationWithPropertyPath when selectFields is empty', async () => {
      const qb = createMockQueryBuilder();
      const repo = createMockRepository(qb);
      (repo.metadata.findRelationWithPropertyPath as jest.Mock).mockReturnValue({
        inverseEntityMetadata: {
          columns: [{ propertyName: 'uId' }, { propertyName: 'email' }],
        },
      });
      qb.getManyAndCount.mockResolvedValue([[], 0]);

      await service.applyPaginationAndFilters(
        repo,
        [],
        {},
        ['agent'],
        {},
        [],
      );

      const selectArg = qb.select.mock.calls[0][0];
      expect(selectArg).toEqual(
        expect.arrayContaining(['agent.uId', 'agent.email']),
      );
      expect(repo.metadata.findRelationWithPropertyPath).toHaveBeenCalledWith(
        'agent',
      );
    });

    it('builds a nested multi-level relation alias in the select clause for deeply dotted selectFields', async () => {
      const qb = createMockQueryBuilder();
      const repo = createMockRepository(qb);
      qb.getManyAndCount.mockResolvedValue([[], 0]);

      await service.applyPaginationAndFilters(
        repo,
        ['offering.agent.uId'],
        {},
        [],
        {},
        [],
      );

      const selectArg = qb.select.mock.calls[0][0];
      expect(selectArg).toEqual(
        expect.arrayContaining(['offering_agent.uId']),
      );
    });
  });

  describe('applyPaginationAndFilters - error handling', () => {
    it('throws an Error when getManyAndCount rejects', async () => {
      const qb = createMockQueryBuilder();
      const repo = createMockRepository(qb);
      qb.getManyAndCount.mockRejectedValue(new Error('DB connection lost'));

      await expect(
        service.applyPaginationAndFilters(repo, [], {}, [], {}, []),
      ).rejects.toThrow('DB connection lost');
    });

    it('wraps non-Error-shaped thrown values as an Error via error.message', async () => {
      const qb = createMockQueryBuilder();
      const repo = createMockRepository(qb);
      qb.getManyAndCount.mockRejectedValue({ message: 'boom' });

      await expect(
        service.applyPaginationAndFilters(repo, [], {}, [], {}, []),
      ).rejects.toThrow('boom');
    });

    it('rethrows the original Error instance, preserving its type and stack', async () => {
      const qb = createMockQueryBuilder();
      const repo = createMockRepository(qb);
      class QueryFailedError extends Error {
        code = 'ER_BAD_FIELD_ERROR';
      }
      const original = new QueryFailedError('bad field');
      qb.getManyAndCount.mockRejectedValue(original);

      await expect(
        service.applyPaginationAndFilters(repo, [], {}, [], {}, []),
      ).rejects.toBe(original);
    });

    it('rejects an unknown whereCondition field instead of splicing it into SQL', async () => {
      const qb = createMockQueryBuilder();
      const repo = createMockRepository(qb);

      await expect(
        service.applyPaginationAndFilters(
          repo,
          [],
          { "id) OR (1=1) --": 'x' },
          [],
          {},
          [],
        ),
      ).rejects.toThrow(/Invalid filter field/);
      expect(qb.andWhere).not.toHaveBeenCalled();
    });

    it('rejects a nested whereCondition field whose relation cannot be resolved', async () => {
      const qb = createMockQueryBuilder();
      const repo = createMockRepository(qb);

      await expect(
        service.applyPaginationAndFilters(
          repo,
          [],
          { 'unknownRelation.someColumn': 'x' },
          [],
          {},
          [],
        ),
      ).rejects.toThrow(/Invalid filter field/);
    });
  });

  describe('applyPaginationAndFilters - page/limit validation', () => {
    it('rejects a zero or negative page', async () => {
      const qb = createMockQueryBuilder();
      const repo = createMockRepository(qb);

      await expect(
        service.applyPaginationAndFilters(repo, [], {}, [], { page: 0 }, []),
      ).rejects.toThrow(/Invalid page/);
      await expect(
        service.applyPaginationAndFilters(repo, [], {}, [], { page: -1 }, []),
      ).rejects.toThrow(/Invalid page/);
    });

    it('rejects a zero, negative, or non-integer limit', async () => {
      const qb = createMockQueryBuilder();
      const repo = createMockRepository(qb);

      await expect(
        service.applyPaginationAndFilters(repo, [], {}, [], { limit: 0 }, []),
      ).rejects.toThrow(/Invalid limit/);
      await expect(
        service.applyPaginationAndFilters(repo, [], {}, [], { limit: -5 }, []),
      ).rejects.toThrow(/Invalid limit/);
      await expect(
        service.applyPaginationAndFilters(
          repo,
          [],
          {},
          [],
          { limit: 2.5 } as any,
          [],
        ),
      ).rejects.toThrow(/Invalid limit/);
    });

    it('rejects a NaN page/limit instead of silently producing skip(NaN)/take(NaN)', async () => {
      const qb = createMockQueryBuilder();
      const repo = createMockRepository(qb);

      await expect(
        service.applyPaginationAndFilters(
          repo,
          [],
          {},
          [],
          { page: NaN } as any,
          [],
        ),
      ).rejects.toThrow(/Invalid page/);
    });
  });

  describe('applyPaginationAndFilters - setColumnsAll / setColumns configuration', () => {
    it('applies "any of" (OR) FIND_IN_SET semantics for a custom setColumns entry', async () => {
      const qb = createMockQueryBuilder();
      const repo = createMockRepository(qb, {
        columns: ['id', 'createdAt', 'updatedAt', 'permissions'],
      });
      qb.getManyAndCount.mockResolvedValue([[], 0]);

      await service.applyPaginationAndFilters(
        repo,
        [],
        { permissions: ['read', 'write'] },
        [],
        {},
        [],
        { field: 'createdAt', order: 'DESC' },
        undefined,
        false,
        { setColumns: ['permissions'], setColumnsAll: [] },
      );

      expect(qb.andWhere).toHaveBeenCalledWith(
        'FIND_IN_SET(:permissions_0, entity.permissions) OR FIND_IN_SET(:permissions_1, entity.permissions)',
        { permissions_0: 'read', permissions_1: 'write' },
      );
    });

    it('no longer special-cases "role"/"orderType" once setColumns/setColumnsAll are overridden to empty', async () => {
      const qb = createMockQueryBuilder();
      const repo = createMockRepository(qb);
      qb.getManyAndCount.mockResolvedValue([[], 0]);

      await service.applyPaginationAndFilters(
        repo,
        [],
        { role: 'ADMIN' },
        [],
        {},
        [],
        { field: 'createdAt', order: 'DESC' },
        undefined,
        false,
        { setColumns: [], setColumnsAll: [] },
      );

      expect(qb.andWhere).toHaveBeenCalledWith('entity.role = :role', {
        role: 'ADMIN',
      });
    });
  });

  describe('fetchAllPaginated', () => {
    it('loops across multiple pages until currentPage >= totalPages, accumulating docs', async () => {
      const fetchFunction = jest
        .fn()
        .mockResolvedValueOnce({ docs: [1, 2], totalPages: 2 })
        .mockResolvedValueOnce({ docs: [3, 4], totalPages: 2 });

      const result = await service.fetchAllPaginated(fetchFunction);

      expect(result).toEqual([1, 2, 3, 4]);
      expect(fetchFunction).toHaveBeenCalledTimes(2);
      expect(fetchFunction).toHaveBeenNthCalledWith(1, 1, 1000, undefined);
      expect(fetchFunction).toHaveBeenNthCalledWith(2, 2, 1000, undefined);
    });

    it('stops after a single page when totalPages is 1', async () => {
      const fetchFunction = jest
        .fn()
        .mockResolvedValueOnce({ docs: [1, 2, 3], totalPages: 1 });

      const result = await service.fetchAllPaginated(fetchFunction, { status: 'active' }, 50);

      expect(result).toEqual([1, 2, 3]);
      expect(fetchFunction).toHaveBeenCalledTimes(1);
      expect(fetchFunction).toHaveBeenCalledWith(1, 50, { status: 'active' });
    });

    it('treats a missing totalPages as 1 page and a missing docs array as empty', async () => {
      const fetchFunction = jest.fn().mockResolvedValueOnce({});

      const result = await service.fetchAllPaginated(fetchFunction);

      expect(result).toEqual([]);
      expect(fetchFunction).toHaveBeenCalledTimes(1);
    });
  });
});
