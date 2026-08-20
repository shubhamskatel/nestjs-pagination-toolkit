import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { PaginationQueryOptions, SortOptions } from '../interfaces/pagination-options.interface';

/**
 * Typed shape of the raw pagination-related query params a NestJS controller
 * receives (all query string values arrive as strings; class-transformer
 * coerces the numeric/enum ones). Validate with class-validator's
 * validate()/validateSync() before trusting it - the @PaginationQuery()
 * decorator does this for you.
 */
export class PaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 10;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;

  @IsOptional()
  @IsString()
  sortField?: string;

  @IsOptional()
  @IsIn(['ASC', 'DESC'])
  sortOrder?: 'ASC' | 'DESC' = 'DESC';

  /**
   * Maps the validated query params onto the shape
   * applyPaginationAndFilters expects for its queryOptions argument.
   */
  toQueryOptions(): PaginationQueryOptions {
    return {
      page: this.page,
      limit: this.limit,
      search: this.search,
      startDate: this.startDate,
      endDate: this.endDate,
    };
  }

  /**
   * Maps the validated query params onto the shape
   * applyPaginationAndFilters expects for its sortOptions argument.
   * Returns undefined when no sortField was supplied, so callers can fall
   * back to their own default via `?? defaultSort`.
   */
  toSortOptions(): SortOptions | undefined {
    if (!this.sortField) return undefined;
    return { field: this.sortField, order: this.sortOrder ?? 'DESC' };
  }
}
