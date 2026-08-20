import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { Author, Book, Review } from './entities';
import { PaginationService } from '../pagination/pagination.service';

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
    type: 'mysql',
    host: 'localhost',
    port: 3306,
    username: 'nest',
    password: 'password',
    database: 'pagination_smoke_test',
    entities: [Author, Book, Review],
    synchronize: true,
    dropSchema: true,
    logging: false,
  });

  await dataSource.initialize();
  console.log('Connected to real MySQL, schema synced.\n');

  const authorRepo = dataSource.getRepository(Author);
  const bookRepo = dataSource.getRepository(Book);
  const reviewRepo = dataSource.getRepository(Review);
  const service = new PaginationService();

  // Author 1 gets 7 books + 3 reviews (two SIMULTANEOUS one-to-many joins,
  // deliberately more rows than our page limit) to stress-test pagination
  // correctness. Authors 2-5 get 0-2 related rows.
  const prolific = await authorRepo.save(
    authorRepo.create({ name: 'Prolific Author', role: 'admin,editor' }),
  );
  const casual = await authorRepo.save(
    authorRepo.create({ name: 'Casual Author', role: 'viewer' }),
  );
  const editor = await authorRepo.save(
    authorRepo.create({ name: 'Editor Author', role: 'editor' }),
  );
  const ghost = await authorRepo.save(
    authorRepo.create({ name: 'Ghost Author', role: '' }),
  );
  const admin2 = await authorRepo.save(
    authorRepo.create({ name: 'Second Admin', role: 'admin' }),
  );

  for (let i = 1; i <= 7; i++) {
    await bookRepo.save(bookRepo.create({ title: `Book ${i}`, authorId: prolific.id }));
  }
  for (let i = 1; i <= 3; i++) {
    await reviewRepo.save(reviewRepo.create({ comment: `Review ${i}`, authorId: prolific.id }));
  }
  await bookRepo.save(bookRepo.create({ title: 'Casual Book', authorId: casual.id }));

  console.log('Seeded 5 authors (7 books + 3 reviews on the first) into a live MySQL database.\n');

  // ---------------------------------------------------------------------
  // 1. Basic pagination + filtering + search, no relations, real query.
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
  // 2. Search filter against a real LOWER(...) LIKE query.
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
  // 3. Opt-in setColumns FIND_IN_SET against a REAL MySQL SET column.
  // ---------------------------------------------------------------------
  const admins = await service.applyPaginationAndFilters(
    authorRepo,
    [],
    { role: 'admin' },
    [],
    {},
    [],
    { field: 'id', order: 'ASC' },
    undefined,
    false,
    { setColumns: ['role'] },
  );
  assertEqual(
    'FIND_IN_SET(role) matches both admins, including a comma-joined SET value',
    admins.docs.map((a) => a.name).sort(),
    ['Prolific Author', 'Second Admin'],
  );

  // ---------------------------------------------------------------------
  // 4. Join + pagination against a real one-to-many relation.
  //
  //    An earlier version of this package shipped an opt-in
  //    `splitJoinedPagination` flag meant to work around a "well-known"
  //    TypeORM bug where skip()/take() combined with leftJoinAndSelect()
  //    on a one-to-many relation was believed to paginate the flattened
  //    joined row stream instead of the primary entity. Running this
  //    against a real MySQL 8.4 instance with TypeORM 0.3.27 disproved
  //    that: getManyAndCount() already runs its own internal id-first,
  //    two-query strategy whenever it detects a to-many join combined
  //    with skip()/take() - the exact same technique the removed flag
  //    tried to bolt on manually (and did incorrectly: it used
  //    skip()/take() on a getRawMany() query, where TypeORM silently
  //    drops LIMIT/OFFSET entirely when a to-many join is present,
  //    returning ALL rows instead of a page).
  //
  //    This test asserts the DEFAULT single-query path is already
  //    correct, including with two simultaneous one-to-many joins, so a
  //    future TypeORM upgrade that regresses this behavior fails loudly
  //    here instead of silently in production.
  // ---------------------------------------------------------------------
  const joined = await service.applyPaginationAndFilters(
    authorRepo,
    [],
    {},
    ['books', 'reviews'],
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
    'joined pagination preserves ALL 3 reviews on the first author (no truncation)',
    joined.docs[0].reviews.length,
    3,
  );
  assertEqual('joined pagination preserves the 1 book on the second author', joined.docs[1].books.length, 1);
  assertEqual('joined pagination total = 5 (correct primary-entity count, not row count)', joined.meta.total, 5);

  const joinedPage2 = await service.applyPaginationAndFilters(
    authorRepo,
    [],
    {},
    ['books', 'reviews'],
    { page: 2, limit: 2 },
    [],
    { field: 'id', order: 'ASC' },
  );
  assertEqual(
    'joined pagination page 2 continues correctly with no overlap/gap',
    joinedPage2.docs.map((a) => a.name),
    ['Editor Author', 'Ghost Author'],
  );

  console.log('\nAll smoke tests passed against a real MySQL instance.');
  await dataSource.destroy();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
