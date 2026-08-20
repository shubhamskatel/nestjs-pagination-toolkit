export * from './pagination.service';
export * from './pagination.module';
export * from './interfaces/pagination-options.interface';

// PaginationQueryDto / PaginationQuery are intentionally NOT re-exported here.
// They pull in class-validator/class-transformer (optional peer deps) at
// module-load time - eagerly re-exporting them from this barrel would break
// `import { PaginationService } from 'nestjs-pagination-toolkit'` for any
// consumer who hasn't installed those two packages, even if they never touch
// the decorator. Import them from the 'nestjs-pagination-toolkit/query'
// subpath instead - see README.
