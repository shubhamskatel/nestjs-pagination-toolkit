import 'reflect-metadata';
import { BadRequestException, ExecutionContext } from '@nestjs/common';
import { paginationQueryFactory } from './pagination-query.decorator';

function createContext(query: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ query }),
    }),
  } as unknown as ExecutionContext;
}

describe('paginationQueryFactory (the @PaginationQuery() decorator body)', () => {
  it('returns a validated PaginationQueryDto with defaults applied for an empty query', () => {
    const dto = paginationQueryFactory(undefined, createContext({}));

    expect(dto.page).toBe(1);
    expect(dto.limit).toBe(10);
    expect(dto.sortOrder).toBe('DESC');
  });

  it('coerces string query params into the typed DTO', () => {
    const dto = paginationQueryFactory(
      undefined,
      createContext({ page: '4', limit: '20', search: 'alice' }),
    );

    expect(dto.page).toBe(4);
    expect(dto.limit).toBe(20);
    expect(dto.search).toBe('alice');
  });

  it('throws BadRequestException for an invalid page', () => {
    expect(() =>
      paginationQueryFactory(undefined, createContext({ page: '-1' })),
    ).toThrow(BadRequestException);
  });

  it('throws BadRequestException for an invalid sortOrder', () => {
    expect(() =>
      paginationQueryFactory(undefined, createContext({ sortOrder: 'sideways' })),
    ).toThrow(BadRequestException);
  });

  it('strips unknown query params rather than passing them through', () => {
    const dto = paginationQueryFactory(
      undefined,
      createContext({ page: '1', evilParam: 'DROP TABLE users' }),
    );

    expect((dto as any).evilParam).toBeUndefined();
  });

  it('defaults the query object to {} when the request has no query at all', () => {
    const ctx = {
      switchToHttp: () => ({ getRequest: () => ({}) }),
    } as unknown as ExecutionContext;

    const dto = paginationQueryFactory(undefined, ctx);

    expect(dto.page).toBe(1);
    expect(dto.limit).toBe(10);
  });
});
