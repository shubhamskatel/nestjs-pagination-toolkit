import {
  BadRequestException,
  ExecutionContext,
  createParamDecorator,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { PaginationQueryDto } from './pagination-query.dto';

/**
 * Extracts, coerces, and validates page/limit/search/sort query params from
 * the request into a PaginationQueryDto. Exported separately from the
 * @PaginationQuery() decorator itself so it can be unit-tested directly,
 * without going through Nest's execution-context machinery.
 */
export function paginationQueryFactory(
  _data: unknown,
  ctx: ExecutionContext,
): PaginationQueryDto {
  const request = ctx.switchToHttp().getRequest();
  const dto = plainToInstance(PaginationQueryDto, request.query ?? {}, {
    enableImplicitConversion: false,
  });

  const errors = validateSync(dto, { whitelist: true });
  if (errors.length > 0) {
    const messages = errors.flatMap((err) => Object.values(err.constraints ?? {}));
    throw new BadRequestException(messages);
  }

  return dto;
}

/**
 * Controller param decorator: `getAll(@PaginationQuery() query: PaginationQueryDto)`.
 * Requires class-validator and class-transformer to be installed by the
 * consuming project (they are optional peer dependencies of this package).
 */
export const PaginationQuery = createParamDecorator(paginationQueryFactory);
