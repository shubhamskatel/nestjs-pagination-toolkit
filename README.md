# nestjs-typeorm-pagination

A single reusable service for NestJS + TypeORM that handles pagination, dynamic
filtering, sorting, search, and relation loading over a `Repository<T>`, so you don't
have to hand-roll `skip()`/`take()`, `WHERE` clause building, and sort/search logic in
every list endpoint.

Most NestJS + TypeORM apps end up writing near-identical query-building code in every
service that exposes a "list X" endpoint: parse `page`/`limit` from the query string,
turn a filter object into `andWhere()` calls, join relations, apply a keyword search
across a few columns, and shape the response into `{ docs, meta }`. This package
centralizes that into one method, `PaginationService.applyPaginationAndFilters`, that
takes a repository plus a small set of plain-object options and returns a paginated
result — while validating anything derived from filter/select input against the
entity's real columns and relations (via `repository.metadata`) before it's spliced
into SQL, so you don't have to sanitize field names yourself.

## Install

Not published to npm yet (see [PUBLISHING.md](./PUBLISHING.md) for what's outstanding).
Until then, consume it from source:

```bash
# from a sibling checkout
npm install /path/to/pagination-service

# or copy src/ into your project and import from there directly
```

Peer dependencies you need in the consuming project:

```bash
npm install @nestjs/common typeorm
# optional, only needed for the @PaginationQuery() decorator:
npm install class-transformer class-validator
```

## Quick usage

```ts
import { Module, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PaginationModule, PaginationService, WhereCondition, PaginationQueryOptions } from 'nestjs-typeorm-pagination';

@Module({
  imports: [PaginationModule],
})
export class BooksModule {}

@Injectable()
export class BooksService {
  constructor(
    @InjectRepository(Book) private bookRepository: Repository<Book>,
    private readonly paginationService: PaginationService,
  ) {}

  list(whereCondition: WhereCondition, options: PaginationQueryOptions) {
    return this.paginationService.applyPaginationAndFilters(
      this.bookRepository,       // repository
      [],                        // selectFields ([] = all columns + joined relation columns)
      whereCondition,            // whereCondition (dynamic filters)
      ['author'],                // relations to left-join
      options,                   // queryOptions (page, limit, search, date filters, ...)
      ['title', 'isbn'],         // searchKeys
      { field: 'createdAt', order: 'DESC' }, // sortOptions
    );
  }
}
```

This returns a `PaginatedResult<T>`:

```ts
interface PaginatedResult<T> {
  docs: T[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}
```

## `applyPaginationAndFilters` — full parameter reference

```ts
applyPaginationAndFilters<T extends object>(
  repository: Repository<T>,
  selectFields: string[],
  whereCondition: WhereCondition,
  relations: string[],
  queryOptions: PaginationQueryOptions,
  searchKeys: string[],
  sortOptions: SortOptions = { field: 'createdAt', order: 'DESC' },
  customQueryBuilder?: SelectQueryBuilder<T>,
  getAllRecords: boolean = false,
  featureOptions: PaginationFeatureOptions = {},
): Promise<PaginatedResult<T>>
```

| Param | Meaning |
| --- | --- |
| `repository` | The TypeORM `Repository<T>` to query. Its `metadata` is used to validate `whereCondition` keys, relation paths, and non-alias sort fields. |
| `selectFields` | Columns to `SELECT`. `[]` selects every entity column plus every column of any joined `relations`. Dot-notated entries (`'author.name'`) select a relation column; the primary key, `createdAt`, and `updatedAt` are always included. |
| `whereCondition` | Plain object of `{ field: value }` (or dot-notated `{ 'relation.field': value }`) filters, ANDed together. Values can be a scalar (`=`), an array (`IN`), `null`/`undefined` (`IS NULL`), or a TypeORM `FindOperator` (see below). |
| `relations` | Relation paths (dot-notated for nested, e.g. `'author.publisher'`) to `leftJoinAndSelect`. |
| `queryOptions` | `{ page?, limit?, search?, startDate?, endDate?, dateRangeFilter? }` — see `PaginationQueryOptions` below. |
| `searchKeys` | Columns (optionally `'alias.column'` for joined relations) that `queryOptions.search` is matched against with a case-insensitive `LIKE`, ORed together. |
| `sortOptions` | `{ field?, expression?, order }` — see below. |
| `customQueryBuilder` | Pass a pre-built `SelectQueryBuilder<T>` (e.g. with extra joins or an `addSelect`) instead of letting the method create `repository.createQueryBuilder('entity')` itself. |
| `getAllRecords` | When `true`, skips applying `.skip()/.take()` — still returns the full `PaginatedResult` shape, just with all matching rows in `docs`. |
| `featureOptions` | `PaginationFeatureOptions` — see below. |

### `PaginationQueryOptions`

```ts
interface PaginationQueryOptions {
  page?: number;                    // default 1
  limit?: number;                   // default 10
  search?: string;
  startDate?: string | Date;        // filters entity.createdAt >= startDate
  endDate?: string | Date;          // filters entity.createdAt <= endDate
  dateRangeFilter?: DateRangeFilter[]; // [{ fieldName, min, max }] -> BETWEEN, per entity column
}
```

`page` and `limit` are validated: non-integer, non-positive, or non-numeric values throw
`Error('Invalid page: must be a positive integer')` (or `limit`) rather than silently
falling back or producing a negative `OFFSET`.

### `SortOptions`

```ts
interface SortOptions {
  field?: string;        // simple column name, e.g. 'createdAt'
  expression?: string;   // raw SQL expression, e.g. 'COALESCE(entity.rank, 0)'
  order: 'ASC' | 'DESC';
}
```

- If `expression` is set, it's passed to `orderBy()` verbatim (see the security section
  below — this is **not** validated).
- Otherwise, if `field` matches a real entity column, it sorts on `entity.<field>`.
- Otherwise, `field` is treated as an alias (e.g. a computed column from a
  `customQueryBuilder`'s `addSelect`) — allowed only if it's absent from
  `entityColumns` and, when `featureOptions.allowedSortAliases` is set, present in that
  allowlist; if the allowlist is set and doesn't contain it, an `Error` is thrown.
- If neither `field` nor `expression` is given, it defaults to `entity.createdAt DESC`.

### `PaginationFeatureOptions`

```ts
interface PaginationFeatureOptions {
  setColumns?: string[];         // MySQL SET columns, "any of" (OR) via FIND_IN_SET. Default [].
  setColumnsAll?: string[];      // MySQL SET columns, "all of" (AND) via FIND_IN_SET. Default [].
  allowedSortAliases?: string[]; // allowlist for non-column sortOptions.field values.
}
```

All three default to empty/undefined — nothing is special-cased unless you opt in.
(An older version of this package hardcoded `['role']`/`['orderType']` as default
`setColumns`/`setColumnsAll`, silently applying FIND_IN_SET matching to any entity with
those column names, including on Postgres, where it made no sense. That default was
removed; you must now name the columns explicitly per call.)

### `FindOperator` support in `whereCondition`

Any TypeORM `FindOperator` can be used as a `whereCondition` value and is translated to
the matching SQL: `In`, `Not`, `LessThan`, `MoreThan`, `LessThanOrEqual`,
`MoreThanOrEqual`, `Between`, `Like`, `ILike`, `IsNull`, `Raw` (string or
`(alias) => string` function form), `And`/`Or` (nested, including nested operators), and
the Postgres array operators `ArrayContains`, `ArrayContainedBy`, `ArrayOverlap`.

## Security / trust boundaries

`applyPaginationAndFilters` builds SQL identifiers (column/relation names) from several
inputs. Most are validated against `repository.metadata` before being used, so an
unexpected or malicious field name fails fast with an `Error` instead of being spliced
into SQL:

- `whereCondition` keys (including dot-notated relation paths) — resolved and checked
  against real columns/relations via an internal `resolveFilterPath`.
- `selectFields` entries — checked against entity/relation columns.
- `dateRangeFilter[].fieldName` — checked against entity columns.
- `sortOptions.field`, when it refers to a real entity column.

Two inputs are **not, and cannot be, validated against metadata** — treat them as
trusted, developer-authored input only, and never build them from raw, unsanitized
request query parameters:

- **`sortOptions.expression`** — an arbitrary raw SQL string passed to `orderBy()`
  as-is.
- **`sortOptions.field`, when it is not a real entity column** — passed through as a
  raw ORDER BY identifier. Set `featureOptions.allowedSortAliases` to restrict it to a
  known allowlist (e.g. computed columns from `addSelect`); without an allowlist, any
  non-column string is accepted.

## MySQL `SET` columns vs. Postgres array columns

MySQL `SET` columns have no native TypeORM operator, so `setColumns`/`setColumnsAll`
exist as an opt-in `FIND_IN_SET`-based workaround. Nothing is enabled by default — pass
the column name(s) explicitly:

```ts
featureOptions: { setColumns: ['permissions'] }    // any of:  FIND_IN_SET(:v, entity.permissions) OR ...
featureOptions: { setColumnsAll: ['permissions'] } // all of:  FIND_IN_SET(:v1, entity.permissions) AND ...
```

`whereCondition` accepts either an array (`{ permissions: ['read', 'write'] }`) or a
comma-separated string for `setColumnsAll`.

**Postgres users don't need this at all.** Native Postgres array columns already have
matching TypeORM `FindOperator`s that this service supports directly — no feature flag:

```ts
import { ArrayOverlap, ArrayContains } from 'typeorm';

{ tags: ArrayOverlap(['fantasy', 'scifi']) }   // "any of" — equivalent to setColumns
{ tags: ArrayContains(['fantasy', 'scifi']) }  // "all of" — equivalent to setColumnsAll
// ArrayContainedBy is also supported (row's array is a subset of the given values)
```

Both mechanisms have been exercised against real databases, not just mocks — see
[Testing](#testing) below.

## Verified against real databases: joins + pagination need no special handling

A common claim about `leftJoinAndSelect` on a one-to-many relation combined with
`skip()`/`take()` is that the LIMIT/OFFSET applies to the flattened joined row stream
rather than the primary entity, truncating pages or child collections. That is true of
old TypeORM 0.2.x, but **not** of TypeORM ^0.3.x, which this package targets.

An earlier version of this package shipped an opt-in `splitJoinedPagination` flag meant
to work around exactly that "bug", by paginating primary-entity ids first and then
fetching full joined entities for those ids. It has since been **removed**, after real
integration testing (`npm run smoke:mysql`, then confirmed independently on Postgres via
`npm run smoke:postgres`) showed:

1. `getManyAndCount()` already runs that same id-first, two-query pagination strategy
   internally and automatically whenever it detects a to-many join combined with
   `skip()`/`take()` — verified via query logging, including with two simultaneous
   one-to-many joins on the same entity, on both MySQL 8.4 and Postgres.
2. The manual `splitJoinedPagination` workaround was not just redundant but actively
   broken: it used `skip()`/`take()` on a `getRawMany()` query, where TypeORM silently
   drops `LIMIT`/`OFFSET` entirely when a to-many join is present.

**Takeaway:** plain `applyPaginationAndFilters` with `relations` set already paginates
correctly on TypeORM ^0.3.x. There is no feature flag for this because none is needed.
If you're still on TypeORM 0.2.x, upgrade rather than work around it.

## `@PaginationQuery()` decorator

Requires the optional peer deps `class-validator` and `class-transformer`.

```ts
import { PaginationQuery, PaginationQueryDto } from 'nestjs-typeorm-pagination';

@Get()
getAll(@PaginationQuery() query: PaginationQueryDto) {
  return this.paginationService.applyPaginationAndFilters(
    this.bookRepository,
    [],
    {},
    [],
    query.toQueryOptions(),
    ['title'],
    query.toSortOptions() ?? { field: 'createdAt', order: 'DESC' },
  );
}
```

It reads `?page=&limit=&search=&startDate=&endDate=&sortField=&sortOrder=` off the raw
query string, coerces `page`/`limit` to integers, validates them with `class-validator`
(rejecting non-integers, values below `1`, or a `sortOrder` outside `ASC`/`DESC`) and
throws a `BadRequestException` on failure, and drops any unrecognized query params
(`whitelist: true`) rather than passing them through. `toQueryOptions()` and
`toSortOptions()` map the validated DTO onto the shapes `applyPaginationAndFilters`
expects (`toSortOptions()` returns `undefined` when no `sortField` was supplied, so you
can fall back to your own default).

## Testing

```bash
npm test           # 88 mocked unit tests, no database required
npm run test:cov   # same, with coverage
```

The unit suite (`src/**/*.spec.ts`) exercises `whereCondition`/`FindOperator` handling
(including nested `And`/`Or`), `setColumns`/`setColumnsAll` opt-in behavior, sorting,
search, relations, select-field validation, page/limit validation, error handling, the
`PaginationQueryDto`, and the `@PaginationQuery()` decorator — all against a mocked
`SelectQueryBuilder`, no real database.

Two additional scripts run the service against **real** databases in Docker and are not
part of the Jest suite:

```bash
npm run smoke:mysql     # requires a local MySQL container (see smoke-test/run.ts for
                         # connection details: localhost:3306, db pagination_smoke_test)
npm run smoke:postgres  # requires a local Postgres container (see smoke-test/run-pg.ts:
                         # localhost:5433, db pagination_smoke_test)
```

- `smoke:mysql` seeds real data with two simultaneous one-to-many joins and verifies
  pagination, filtering, sorting, search, and `setColumns`/`setColumnsAll` FIND_IN_SET
  matching against actual MySQL 8.4.
- `smoke:postgres` seeds real array-column data and verifies the same pagination/join
  correctness plus `ArrayOverlap`/`ArrayContains`/`ArrayContainedBy` against actual
  Postgres.

Both require the respective container to already be running locally (see each file's
`DataSource` config for exact host/port/credentials); neither is run in CI by default.

## Not implemented / out of scope

- Cursor-based (keyset) pagination — offset-based (`page`/`limit` via `skip`/`take`)
  only, by design for now.
- No caching of count queries — `getManyAndCount()` always runs both queries.
- No built-in rate limiting or query-cost guards on `limit` — callers should bound
  `limit` themselves if untrusted clients can set it arbitrarily high.

## Publishing status

Not yet published to npm. `package.json` is versioned `0.1.0` as a placeholder and still
has an author/repository-URL placeholder. See [PUBLISHING.md](./PUBLISHING.md) for the
full pre-publish checklist and open decisions.
