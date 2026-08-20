import 'reflect-metadata';
import { ArrayContainedBy, ArrayContains, ArrayOverlap, DataSource } from 'typeorm';
import { Author, Book } from './entities-pg';
import { PaginationService } from '../src/pagination.service';

function assertEqual(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`FAIL: ${label}\n  expected: ${e}\n  actual:   ${a}`);
  }
  console.log(`PASS: ${label}`);
}

async function main() {
  const dataSource = new DataSource({
    type: 'postgres',
    host: 'localhost',
    port: 5433,
    username: 'postgres',
    password: 'password',
    database: 'pagination_smoke_test',
    entities: [Author, Book],
    synchronize: true,
    dropSchema: true,
    logging: false,
  });

  await dataSource.initialize();
  console.log('Connected to real Postgres, schema synced.\n');

  const authorRepo = dataSource.getRepository(Author);
  const bookRepo = dataSource.getRepository(Book);
  const service = new PaginationService();

  // Author 1 gets 7 books (deliberately more than our page limit) to
  // stress-test pagination+join correctness on Postgres specifically -
  // do not assume the MySQL finding (that TypeORM's default
  // getManyAndCount() already runs a correct internal id-first two-query
  // strategy for to-many joins + skip()/take()) transfers automatically.
  const prolific = await authorRepo.save(
    authorRepo.create({
      name: 'Prolific Author',
      tags: ['fiction', 'bestseller', 'fantasy'],
    }),
  );
  const casual = await authorRepo.save(
    authorRepo.create({ name: 'Casual Author', tags: ['fiction', 'romance'] }),
  );
  const editor = await authorRepo.save(
    authorRepo.create({ name: 'Editor Author', tags: ['nonfiction', 'history'] }),
  );
  const ghost = await authorRepo.save(
    authorRepo.create({ name: 'Ghost Author', tags: [] }),
  );
  const admin2 = await authorRepo.save(
    authorRepo.create({ name: 'Second Admin', tags: ['fantasy', 'scifi'] }),
  );

  for (let i = 1; i <= 7; i++) {
    await bookRepo.save(bookRepo.create({ title: `Book ${i}`, authorId: prolific.id }));
  }
  await bookRepo.save(bookRepo.create({ title: 'Casual Book', authorId: casual.id }));

  console.log('Seeded 5 authors (7 books on the first) into a live Postgres database.\n');

  // ---------------------------------------------------------------------
  // 1. Basic pagination, no relations, real query.
  // ---------------------------------------------------------------------
  const basic = await service.applyPaginationAndFilters(
    authorRepo,
    [],
    {},
    [],
    { page: 1, limit: 2 },
    ['name'],
    { field: 'id', order: 'ASC' },
  );
  assertEqual('basic pagination returns 2 docs', basic.docs.length, 2);
  assertEqual('basic pagination total = 5', basic.meta.total, 5);
  assertEqual('basic pagination totalPages = 3', basic.meta.totalPages, 3);
  assertEqual(
    'basic pagination page 1 = first two authors by id',
    basic.docs.map((a) => a.name),
    ['Prolific Author', 'Casual Author'],
  );

  // ---------------------------------------------------------------------
  // 2. Plain equality filter, real query.
  // ---------------------------------------------------------------------
  const equalityFiltered = await service.applyPaginationAndFilters(
    authorRepo,
    [],
    { name: 'Editor Author' },
    [],
    {},
    [],
    { field: 'id', order: 'ASC' },
  );
  assertEqual(
    'equality filter finds exactly the editor author',
    equalityFiltered.docs.map((a) => a.name),
    ['Editor Author'],
  );

  // ---------------------------------------------------------------------
  // 3. Search filter against a real LOWER(...) LIKE query.
  // ---------------------------------------------------------------------
  const searched = await service.applyPaginationAndFilters(
    authorRepo,
    [],
    {},
    [],
    { search: 'ghost' },
    ['name'],
    { field: 'id', order: 'ASC' },
  );
  assertEqual('search finds exactly the ghost author', searched.docs.map((a) => a.name), [
    'Ghost Author',
  ]);

  // ---------------------------------------------------------------------
  // 4. Native Postgres text[] column + TypeORM FindOperators.
  //
  //    The README claims Postgres users get "any of"/"all of"
  //    SET-column-equivalent matching for free via ArrayOverlap (&&),
  //    ArrayContains (@>), and ArrayContainedBy (<@). This was previously
  //    verified only against a fully-mocked query builder. Each case
  //    below is picked so that swapping the SQL operator direction (or
  //    binding the array param wrong) would flip the result set, not
  //    just throw an error.
  // ---------------------------------------------------------------------

  // "any of" - ArrayOverlap(['history','scifi']) - overlap (&&).
  // If this were implemented as @> instead, NEITHER author would match
  // (Editor Author only has 'history', Second Admin only has 'scifi',
  // neither contains BOTH values), so this distinguishes && from @>.
  const overlapQb = authorRepo
    .createQueryBuilder('author')
    .where('author.tags && :tags', { tags: ['history', 'scifi'] });
  console.log('DEBUG ArrayOverlap SQL:', overlapQb.getSql());
  const overlap = await service.applyPaginationAndFilters(
    authorRepo,
    [],
    { tags: ArrayOverlap(['history', 'scifi']) },
    [],
    {},
    [],
    { field: 'id', order: 'ASC' },
  );
  assertEqual(
    'ArrayOverlap("any of") matches the history author and the scifi author only',
    overlap.docs.map((a) => a.name).sort(),
    ['Editor Author', 'Second Admin'],
  );

  // "all of" - ArrayContains(['fiction','bestseller']) - contains (@>),
  // i.e. row's array is a SUPERSET of the given values.
  // Prolific Author's tags = ['fiction','bestseller','fantasy'] contains
  // both values (plus an extra 'fantasy' tag). If the operator were
  // swapped to <@ (row is a subset of the param), Prolific Author would
  // NOT match because 'fantasy' is not in the 2-element param array -
  // so this distinguishes @> from <@.
  const containsQb = authorRepo
    .createQueryBuilder('author')
    .where('author.tags @> :tags', { tags: ['fiction', 'bestseller'] });
  console.log('DEBUG ArrayContains SQL:', containsQb.getSql());
  const contains = await service.applyPaginationAndFilters(
    authorRepo,
    [],
    { tags: ArrayContains(['fiction', 'bestseller']) },
    [],
    {},
    [],
    { field: 'id', order: 'ASC' },
  );
  assertEqual(
    'ArrayContains("all of") matches only the author whose tags are a superset',
    contains.docs.map((a) => a.name),
    ['Prolific Author'],
  );

  // ArrayContainedBy(['fiction','romance','mystery']) - contained by (<@),
  // i.e. row's array is a SUBSET of the given values.
  // Casual Author's tags = ['fiction','romance'] is a subset. Ghost
  // Author's tags = [] (empty array) is trivially a subset of everything,
  // which is the correct <@ semantics, and also a real edge case: an
  // empty array param bound incorrectly (or the operator swapped to @>)
  // would change this result.
  const containedByQb = authorRepo
    .createQueryBuilder('author')
    .where('author.tags <@ :tags', { tags: ['fiction', 'romance', 'mystery'] });
  console.log('DEBUG ArrayContainedBy SQL:', containedByQb.getSql());
  const containedBy = await service.applyPaginationAndFilters(
    authorRepo,
    [],
    { tags: ArrayContainedBy(['fiction', 'romance', 'mystery']) },
    [],
    {},
    [],
    { field: 'id', order: 'ASC' },
  );
  assertEqual(
    'ArrayContainedBy("subset of") matches the subset author and the empty-array author',
    containedBy.docs.map((a) => a.name).sort(),
    ['Casual Author', 'Ghost Author'],
  );

  // ---------------------------------------------------------------------
  // 5. Join + pagination against a real one-to-many relation, on
  //    Postgres specifically. Do not assume the MySQL result transfers:
  //    Postgres's planner and TypeORM's SQL generation for it could
  //    differ.
  // ---------------------------------------------------------------------
  const joined = await service.applyPaginationAndFilters(
    authorRepo,
    [],
    {},
    ['books'],
    { page: 1, limit: 2 },
    [],
    { field: 'id', order: 'ASC' },
  );
  assertEqual('joined pagination returns exactly 2 full authors', joined.docs.length, 2);
  assertEqual(
    'joined pagination preserves ALL 7 books on the first author (no truncation)',
    joined.docs[0].books.length,
    7,
  );
  assertEqual(
    'joined pagination preserves the 1 book on the second author',
    joined.docs[1].books.length,
    1,
  );
  assertEqual('joined pagination total = 5 (correct primary-entity count, not row count)', joined.meta.total, 5);

  const joinedPage2 = await service.applyPaginationAndFilters(
    authorRepo,
    [],
    {},
    ['books'],
    { page: 2, limit: 2 },
    [],
    { field: 'id', order: 'ASC' },
  );
  assertEqual(
    'joined pagination page 2 continues correctly with no overlap/gap',
    joinedPage2.docs.map((a) => a.name),
    ['Editor Author', 'Ghost Author'],
  );

  console.log('\nAll smoke tests passed against a real Postgres instance.');
  await dataSource.destroy();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
