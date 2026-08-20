import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { PaginationQueryDto } from './pagination-query.dto';

function build(raw: Record<string, unknown>): {
  dto: PaginationQueryDto;
  errors: ReturnType<typeof validateSync>;
} {
  const dto = plainToInstance(PaginationQueryDto, raw);
  const errors = validateSync(dto, { whitelist: true });
  return { dto, errors };
}

describe('PaginationQueryDto', () => {
  it('applies page=1 and limit=10 defaults, and sortOrder=DESC, when omitted', () => {
    const { dto, errors } = build({});

    expect(errors).toHaveLength(0);
    expect(dto.page).toBe(1);
    expect(dto.limit).toBe(10);
    expect(dto.sortOrder).toBe('DESC');
  });

  it('coerces string page/limit query values into numbers', () => {
    const { dto, errors } = build({ page: '3', limit: '25' });

    expect(errors).toHaveLength(0);
    expect(dto.page).toBe(3);
    expect(dto.limit).toBe(25);
  });

  it('rejects a zero or negative page', () => {
    expect(build({ page: '0' }).errors.length).toBeGreaterThan(0);
    expect(build({ page: '-1' }).errors.length).toBeGreaterThan(0);
  });

  it('rejects a non-integer limit', () => {
    expect(build({ limit: '2.5' }).errors.length).toBeGreaterThan(0);
  });

  it('rejects a non-numeric page/limit', () => {
    expect(build({ page: 'abc' }).errors.length).toBeGreaterThan(0);
  });

  it('rejects a sortOrder outside ASC/DESC', () => {
    expect(build({ sortOrder: 'SIDEWAYS' }).errors.length).toBeGreaterThan(0);
  });

  it('accepts a valid full query and passes through search/sort/date fields', () => {
    const { dto, errors } = build({
      page: '2',
      limit: '5',
      search: 'alice',
      startDate: '2026-01-01',
      endDate: '2026-02-01',
      sortField: 'createdAt',
      sortOrder: 'ASC',
    });

    expect(errors).toHaveLength(0);
    expect(dto).toMatchObject({
      page: 2,
      limit: 5,
      search: 'alice',
      startDate: '2026-01-01',
      endDate: '2026-02-01',
      sortField: 'createdAt',
      sortOrder: 'ASC',
    });
  });

  describe('toQueryOptions', () => {
    it('maps validated fields onto the shape applyPaginationAndFilters expects', () => {
      const { dto } = build({ page: '2', limit: '5', search: 'bob' });

      expect(dto.toQueryOptions()).toEqual({
        page: 2,
        limit: 5,
        search: 'bob',
        startDate: undefined,
        endDate: undefined,
      });
    });
  });

  describe('toSortOptions', () => {
    it('returns undefined when no sortField was supplied', () => {
      const { dto } = build({});
      expect(dto.toSortOptions()).toBeUndefined();
    });

    it('returns a SortOptions object when sortField is supplied, defaulting order to DESC', () => {
      const { dto } = build({ sortField: 'name' });
      expect(dto.toSortOptions()).toEqual({ field: 'name', order: 'DESC' });
    });

    it('respects an explicit sortOrder', () => {
      const { dto } = build({ sortField: 'name', sortOrder: 'ASC' });
      expect(dto.toSortOptions()).toEqual({ field: 'name', order: 'ASC' });
    });
  });
});
