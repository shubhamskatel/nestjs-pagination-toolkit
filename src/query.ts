// Separate entry point (import from 'nestjs-pagination-toolkit/query') so
// that the core PaginationService/PaginationModule import doesn't eagerly
// pull in class-validator/class-transformer, which are optional peer
// dependencies only needed if you use this decorator/DTO.
export * from './dto/pagination-query.dto';
export * from './decorators/pagination-query.decorator';
