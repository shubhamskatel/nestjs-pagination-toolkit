export interface PaginatedResult<T> {
  docs: T[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export interface SortOptions {
  field?: string; // For simple column sorting (e.g., 'createdAt')
  expression?: string; // For complex SQL expression sorting (e.g., 'COALESCE(...)')
  order: 'ASC' | 'DESC';
}

export interface DateRangeFilter {
  fieldName?: string;
  min?: string | number | Date;
  max?: string | number | Date;
}

export interface PaginationQueryOptions {
  page?: number;
  limit?: number;
  search?: string;
  startDate?: string | Date;
  endDate?: string | Date;
  dateRangeFilter?: DateRangeFilter[];
  tokenAddresses?: string[];
}

export type WhereCondition = Record<string, unknown>;

export interface PaginationFeatureOptions {
  /**
   * MySQL SET-column names matched via FIND_IN_SET with "any of" (OR)
   * semantics: a row matches if it contains at least one provided value.
   * Opt-in; defaults to [] (no special-casing). On Postgres, use the
   * ArrayOverlap(...) FindOperator on the column directly instead.
   */
  setColumns?: string[];
  /**
   * MySQL SET-column names matched via FIND_IN_SET with "all of" (AND)
   * semantics: a row matches only if it contains every provided value.
   * Accepts an array or a comma-separated string. Opt-in; defaults to []
   * (no special-casing). On Postgres, use the ArrayContains(...)
   * FindOperator on the column directly instead.
   */
  setColumnsAll?: string[];
  /**
   * Sort aliases (values of sortOptions.field that are not real entity
   * columns) that are allowed through without validation, e.g. computed
   * columns added via addSelect. Anything not in entityColumns and not
   * in this list is rejected.
   */
  allowedSortAliases?: string[];
}
