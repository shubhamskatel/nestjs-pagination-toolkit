# nestjs-typeorm-pagination

Reusable pagination, dynamic filtering, sorting, and search for NestJS + TypeORM repositories.

## Install

Not published yet. For now, copy the `pagination/` folder into your project or install from a local path:

```bash
npm install typeorm @nestjs/common # peer deps, if not already present
```

## Usage

```ts
import { Module } from '@nestjs/common';
import { PaginationModule } from './pagination/pagination.module';

@Module({
  imports: [PaginationModule],
})
export class AppModule {}
```

```ts
@Injectable()
export class StakeService {
  constructor(
    @InjectRepository(Stakes) private stakeRepository: Repository<Stakes>,
    private readonly paginationService: PaginationService,
  ) {}

  getTransactions(whereCondition: WhereCondition, options: PaginationQueryOptions) {
    return this.paginationService.applyPaginationAndFilters(
      this.stakeRepository,
      [],
      whereCondition,
      [],
      options,
      ['walletAddress', 'transactionHash'],
      { field: 'createdAt', order: 'DESC' },
    );
  }
}
```

## Security: trust boundaries

`applyPaginationAndFilters` builds SQL identifiers from several inputs. Most are now
validated against `repository.metadata` before use (`whereCondition` keys, relation
paths in `selectFields`), but two are **not**, because they can't be validated against
metadata — treat them as trusted, developer-controlled input, never build them from raw
request query params:

- `sortOptions.expression` — an arbitrary raw SQL expression, used as-is.
- `sortOptions.field`, when it isn't a real entity column — passed through as a raw
  alias unless you provide `featureOptions.allowedSortAliases` to allowlist it.

## Feature options (5th-from-last argument)

```ts
interface PaginationFeatureOptions {
  setColumns?: string[];       // MySQL SET columns matched "any of" (OR) via FIND_IN_SET. Opt-in, default [].
  setColumnsAll?: string[];    // MySQL SET columns matched "all of" (AND) via FIND_IN_SET. Opt-in, default [].
  allowedSortAliases?: string[]; // strict allowlist for sortOptions.field custom aliases; omit for legacy permissive behavior.
}
```

## Cross-dialect "any of" / "all of" column matching

MySQL SET columns have no native TypeORM operator, which is why `setColumns`/
`setColumnsAll` exist as an opt-in `FIND_IN_SET`-based workaround — pass the column
name(s) explicitly, nothing is special-cased by default:

```ts
featureOptions: { setColumns: ['role'] }        // WHERE FIND_IN_SET(:v, entity.role) OR ...
featureOptions: { setColumnsAll: ['orderType'] } // WHERE FIND_IN_SET(:v1, entity.orderType) AND ...
```

**Postgres users don't need any of this.** Postgres array columns already have native
TypeORM `FindOperator`s that this service supports out of the box — just pass them
directly as the `whereCondition` value, no feature flag required:

```ts
import { ArrayOverlap, ArrayContains } from 'typeorm';

{ roles: ArrayOverlap(['admin', 'editor']) }   // "any of" — matches setColumns semantics
{ roles: ArrayContains(['admin', 'editor']) }  // "all of" — matches setColumnsAll semantics
```

## Query param parsing: `@PaginationQuery()`

Requires `class-validator` and `class-transformer` (optional peer deps — install them if
you use this decorator):

```ts
import { PaginationQuery, PaginationQueryDto } from './pagination/pagination-query.decorator';

@Get()
getAll(@PaginationQuery() query: PaginationQueryDto) {
  return this.paginationService.applyPaginationAndFilters(
    this.repo,
    [],
    {},
    [],
    query.toQueryOptions(),
    ['name'],
    query.toSortOptions() ?? { field: 'createdAt', order: 'DESC' },
  );
}
```

It parses `?page=&limit=&search=&startDate=&endDate=&sortField=&sortOrder=` from the raw
query string, coerces `page`/`limit` to integers, validates them (rejects 0, negative,
non-integer, or a `sortOrder` outside `ASC`/`DESC`) with a `BadRequestException`, and
strips any unrecognized query params instead of passing them through.

## Pagination + one-to-many joins: verified correct, no extra flag needed

`leftJoinAndSelect` on a one-to-many relation combined with `skip()`/`take()` is often
cited as a TypeORM footgun — the LIMIT/OFFSET supposedly applies to the flattened joined
row stream instead of the primary entity, truncating pages or child collections. That
description matches old TypeORM 0.2.x.

An earlier version of this package shipped an opt-in `splitJoinedPagination` flag meant
to work around exactly that, by paginating primary-entity ids first (no join-and-select),
then fetching full joined entities for those ids. It was removed after running it against
a real MySQL 8.4 instance with TypeORM 0.3.27 (`npm run smoke:mysql`): `getManyAndCount()`
already runs that same id-first, two-query strategy internally and automatically whenever
it detects a to-many join combined with `skip()`/`take()` — confirmed via query logging,
including with **two simultaneous** one-to-many joins on the same entity. The manually
built flag was also redundant AND had a real bug of its own (it used `skip()`/`take()` on
a `getRawMany()` query, where TypeORM silently drops `LIMIT`/`OFFSET` entirely when a
to-many join is present — a separate, subtler gotcha than the one it was trying to fix).

No feature flag needed: plain `applyPaginationAndFilters` with `relations` set already
paginates correctly on TypeORM ^0.3.x. If you're on TypeORM 0.2.x, upgrade rather than
work around it.

## Testing

```bash
npm test          # mocked unit tests (no DB required)
npm run smoke:mysql   # integration smoke test against a real MySQL instance
                       # (defaults assume a local container: host=localhost, port=3306,
                       # user=nest, password=password, db=pagination_smoke_test - see
                       # smoke-test/run.ts to point it at your own database)
```

## Not implemented

- Cursor-based pagination (offset-based only, by design for now).
