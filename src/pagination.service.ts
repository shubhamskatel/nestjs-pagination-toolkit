import {
  Brackets,
  FindOperator,
  InstanceChecker,
  Repository,
  SelectQueryBuilder,
} from 'typeorm';
import {
  PaginatedResult,
  PaginationFeatureOptions,
  PaginationQueryOptions,
  SortOptions,
  WhereCondition,
} from './interfaces/pagination-options.interface';

export {
  PaginatedResult,
  SortOptions,
  PaginationQueryOptions,
  PaginationFeatureOptions,
  WhereCondition,
} from './interfaces/pagination-options.interface';

// No defaults: MySQL SET-column (FIND_IN_SET) matching is opt-in via
// featureOptions.setColumns/setColumnsAll. Earlier versions hardcoded
// ['role']/['orderType'] here, which silently special-cased those column
// names for every consumer, including ones on Postgres with no such
// columns. Postgres users get the equivalent "any of"/"all of" semantics
// natively via the ArrayOverlap/ArrayContains FindOperators instead.
const DEFAULT_SET_COLUMNS_ANY: string[] = [];
const DEFAULT_SET_COLUMNS_ALL: string[] = [];

export class PaginationService {
  async applyPaginationAndFilters<T extends object>(
    repository: Repository<T>,
    selectFields: string[],
    whereCondition: WhereCondition,
    relations: string[],
    queryOptions: PaginationQueryOptions,
    searchKeys: string[],
    sortOptions: SortOptions = {
      field: 'createdAt',
      order: 'DESC',
    },
    customQueryBuilder?: SelectQueryBuilder<T>,
    getAllRecords: boolean = false,
    featureOptions: PaginationFeatureOptions = {},
  ): Promise<PaginatedResult<T>> {
    try {
      const setColumns = featureOptions.setColumns ?? DEFAULT_SET_COLUMNS_ANY;
      const setColumnsAll =
        featureOptions.setColumnsAll ?? DEFAULT_SET_COLUMNS_ALL;
      const { search, startDate, endDate, dateRangeFilter } = queryOptions;
      const page = this.normalizePageOrLimit(queryOptions.page, 1, 'page');
      const limit = this.normalizePageOrLimit(queryOptions.limit, 10, 'limit');
      const skip = (page - 1) * limit;

      const entityColumns = repository.metadata.columns.map(
        (col) => col.propertyName,
      );

      const buildFilteredQuery = (
        queryBuilder: SelectQueryBuilder<any>,
        joinAndSelect: boolean,
      ) => {
        this.applyDynamicFilters(
          repository,
          queryBuilder,
          whereCondition,
          entityColumns,
          setColumns,
          setColumnsAll,
        );

        if (startDate)
          queryBuilder.andWhere('entity.createdAt >= :startDate', {
            startDate,
          });
        if (endDate)
          queryBuilder.andWhere('entity.createdAt <= :endDate', { endDate });

        this.applyDateRangeFilters(queryBuilder, dateRangeFilter, entityColumns);
        this.applyRelations(queryBuilder, relations, joinAndSelect);
        this.applySearch(queryBuilder, search, searchKeys);
        return queryBuilder;
      };

      const queryBuilder: SelectQueryBuilder<any> =
        customQueryBuilder ?? repository.createQueryBuilder('entity');

      buildFilteredQuery(queryBuilder, true);

      const selectClause = this.buildSelectClause(
        repository,
        selectFields,
        entityColumns,
        relations,
      );
      queryBuilder.select([...new Set(selectClause)]);

      this.applySort(queryBuilder, sortOptions, entityColumns, featureOptions);

      if (!getAllRecords) {
        queryBuilder.skip(skip).take(limit);
      }

      const [data, totalCount] = await queryBuilder.getManyAndCount();

      return {
        docs: data,
        meta: {
          total: totalCount,
          page,
          limit,
          totalPages: Math.ceil(totalCount / limit),
        },
      };
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      const message = (error as { message?: string })?.message ?? String(error);
      throw new Error(message);
    }
  }

  private normalizePageOrLimit(
    value: unknown,
    fallback: number,
    label: 'page' | 'limit',
  ): number {
    if (value === undefined || value === null) return fallback;
    const num = Number(value);
    if (!Number.isFinite(num) || !Number.isInteger(num) || num < 1) {
      throw new Error(`Invalid ${label}: must be a positive integer`);
    }
    return num;
  }

  private applyDateRangeFilters(
    queryBuilder: SelectQueryBuilder<any>,
    dateRangeFilter: PaginationQueryOptions['dateRangeFilter'],
    entityColumns: string[],
  ) {
    if (!Array.isArray(dateRangeFilter)) return;
    dateRangeFilter.forEach((filter, index) => {
      if (filter?.fieldName && filter?.min && filter?.max) {
        if (!entityColumns.includes(filter.fieldName)) {
          throw new Error(`Invalid dateRangeFilter field: ${filter.fieldName}`);
        }
        queryBuilder.andWhere(
          `entity.${filter.fieldName} BETWEEN :min${index} AND :max${index}`,
          {
            [`min${index}`]: filter.min,
            [`max${index}`]: filter.max,
          },
        );
      }
    });
  }

  private applyRelations(
    queryBuilder: SelectQueryBuilder<any>,
    relations: string[],
    joinAndSelect: boolean,
  ) {
    relations.forEach((relation) => {
      const parts = relation.split('.');
      let parentAlias = 'entity';
      parts.forEach((currentRelation, index) => {
        const alias = parts.slice(0, index + 1).join('_');
        if (!queryBuilder.expressionMap.aliases.some((a) => a.name === alias)) {
          if (joinAndSelect) {
            queryBuilder.leftJoinAndSelect(`${parentAlias}.${currentRelation}`, alias);
          } else {
            queryBuilder.leftJoin(`${parentAlias}.${currentRelation}`, alias);
          }
        }
        parentAlias = alias;
      });
    });
  }

  private buildSelectClause(
    repository: Repository<any>,
    selectFields: string[],
    entityColumns: string[],
    relations: string[],
  ): string[] {
    const primaryColumn = repository.metadata.primaryColumns[0]?.propertyName;

    if (selectFields.length > 0) {
      return [
        ...new Set([...selectFields, primaryColumn, 'createdAt', 'updatedAt']),
      ].map((field) => {
        const parts = field.split('.');

        if (parts.length > 1) {
          const column = parts.pop() as string;
          const relationAlias = parts.join('_');
          const relationPath = parts.join('.');
          const relationMetadata =
            repository.metadata.findRelationWithPropertyPath(relationPath);
          if (relationMetadata) {
            const relatedColumns = relationMetadata.inverseEntityMetadata.columns.map(
              (col) => col.propertyName,
            );
            if (!relatedColumns.includes(column)) {
              throw new Error(`Invalid selectFields entry: ${field}`);
            }
          }
          return `${relationAlias}.${column}`;
        }

        if (entityColumns.includes(field)) {
          return `entity.${field}`;
        } else {
          return field;
        }
      });
    }

    const relationColumns: string[] = [];
    relations.forEach((relation) => {
      const relationMetadata =
        repository.metadata.findRelationWithPropertyPath(relation);
      if (relationMetadata) {
        const relatedEntityColumns =
          relationMetadata.inverseEntityMetadata.columns.map(
            (col) => col.propertyName,
          );
        relatedEntityColumns.forEach((col) => {
          relationColumns.push(`${relation}.${col}`);
        });
      }
    });
    return [
      ...entityColumns.map((col) => `entity.${col}`),
      ...relationColumns.map((field) => {
        const parts = field.split('.');
        const column = parts.pop();
        const relationAlias = parts.join('_');
        return `${relationAlias}.${column}`;
      }),
    ];
  }

  private applySort(
    queryBuilder: SelectQueryBuilder<any>,
    sortOptions: SortOptions,
    entityColumns: string[],
    featureOptions: PaginationFeatureOptions,
  ) {
    if (sortOptions.expression) {
      // Trusted-input escape hatch: callers must never pass client-supplied
      // strings here, since it is not validated against entity metadata.
      queryBuilder.orderBy(sortOptions.expression, sortOptions.order);
    } else if (sortOptions.field) {
      if (entityColumns.includes(sortOptions.field)) {
        queryBuilder.orderBy(`entity.${sortOptions.field}`, sortOptions.order);
      } else {
        if (
          featureOptions.allowedSortAliases &&
          !featureOptions.allowedSortAliases.includes(sortOptions.field)
        ) {
          throw new Error(`Invalid sort field: ${sortOptions.field}`);
        }
        queryBuilder.orderBy(sortOptions.field, sortOptions.order);
      }
    } else {
      queryBuilder.orderBy('entity.createdAt', 'DESC');
    }
  }

  private applySearch(
    queryBuilder: SelectQueryBuilder<any>,
    search: string | undefined,
    searchKeys: string[],
  ) {
    if (!search || searchKeys.length === 0) return;

    queryBuilder.andWhere(
      new Brackets((qb) => {
        const conditions: string[] = [];
        const parameters: Record<string, any> = {};
        const searchLower = search.toLowerCase();

        const searchWords = searchLower.split(' ').filter(Boolean);

        const aliasGroups: Record<string, Set<string>> = {};

        searchKeys.forEach((key) => {
          const [alias, column] = key.includes('.')
            ? key.split('.')
            : ['entity', key];
          if (!aliasGroups[alias]) aliasGroups[alias] = new Set();
          aliasGroups[alias].add(column);
        });

        if (searchWords.length >= 2) {
          const combinedParam = `combined_full_name`;
          const combinedValue = `%${searchLower}%`;
          parameters[combinedParam] = combinedValue;

          Object.entries(aliasGroups).forEach(([alias, columns]) => {
            if (columns.has('firstName') && columns.has('lastName')) {
              conditions.push(
                `LOWER(CONCAT(${alias}.firstName, ' ', ${alias}.lastName)) LIKE :${combinedParam}`,
              );
            }
          });
        }

        searchKeys.forEach((key, index) => {
          const [alias, column] = key.includes('.')
            ? key.split('.')
            : ['entity', key];
          const paramKey = `search_${index}`;
          conditions.push(`LOWER(${alias}.${column}) LIKE :${paramKey}`);
          parameters[paramKey] = `%${searchLower}%`;
        });

        qb.where(conditions.join(' OR '));
        queryBuilder.setParameters(parameters);
      }),
    );
  }

  /**
   * Resolves a (possibly dot-notated) whereCondition key against the
   * repository's real columns/relations before it is ever spliced into a
   * SQL fragment, so an unexpected key (e.g. one built from unsanitized
   * client input) fails fast instead of producing an injectable identifier.
   */
  private resolveFilterPath(
    repository: Repository<any>,
    key: string,
    entityColumns: string[],
  ): { alias: string; column: string; dbColumn: string; paramKey: string } {
    const keyParts = key.split('.');
    const column = keyParts.pop() as string;
    const isNested = keyParts.length > 0;
    const paramKey = key.replace(/\./g, '_');

    if (!isNested) {
      if (!entityColumns.includes(column)) {
        throw new Error(`Invalid filter field: ${key}`);
      }
      return { alias: 'entity', column, dbColumn: `entity.${column}`, paramKey };
    }

    const relationPath = keyParts.join('.');
    const relationMetadata =
      repository.metadata.findRelationWithPropertyPath(relationPath);
    if (!relationMetadata) {
      throw new Error(`Invalid filter field: ${key}`);
    }
    const relatedColumns = relationMetadata.inverseEntityMetadata.columns.map(
      (col) => col.propertyName,
    );
    if (!relatedColumns.includes(column)) {
      throw new Error(`Invalid filter field: ${key}`);
    }
    const alias = keyParts.join('_');
    return { alias, column, dbColumn: `${alias}.${column}`, paramKey };
  }

  private applyDynamicFilters<T extends object>(
    repository: Repository<T>,
    queryBuilder: SelectQueryBuilder<T>,
    whereCondition: WhereCondition,
    entityColumns: string[],
    setColumns: string[],
    setColumnsAll: string[],
  ) {
    const resolveFindOperator = (
      operator: FindOperator<any>,
    ): { type: string; value: any } => {
      let current = operator;
      while (current.value instanceof FindOperator) {
        current = current.value;
      }
      return { type: current.type, value: current.value };
    };

    Object.entries(whereCondition).forEach(([key, value]) => {
      const { alias, column, dbColumn, paramKey } = this.resolveFilterPath(
        repository,
        key,
        entityColumns,
      );

      if (alias === 'entity' && setColumnsAll.includes(column)) {
        // "all of" (AND) semantics: row must contain every provided value.
        const parts: string[] = (
          Array.isArray(value) ? value : String(value).split(',')
        )
          .map((v) => String(v).trim())
          .filter(Boolean);

        if (parts.length === 0) return;

        const uniqueParts = Array.from(new Set(parts));
        const conditions: string[] = [];
        const parameters: Record<string, any> = {};

        uniqueParts.forEach((val, idx) => {
          const p = `${column}_${idx}`;
          conditions.push(`FIND_IN_SET(:${p}, ${dbColumn})`);
          parameters[p] = val;
        });

        queryBuilder.andWhere(conditions.join(' AND '), parameters);
      } else if (alias === 'entity' && setColumns.includes(column)) {
        // "any of" (OR) semantics: row must contain at least one provided value.
        if (Array.isArray(value)) {
          const conditions: string[] = [];
          const parameters: Record<string, any> = {};

          value.forEach((val, idx) => {
            const p = `${column}_${idx}`;
            conditions.push(`FIND_IN_SET(:${p}, ${dbColumn})`);
            parameters[p] = val;
          });

          queryBuilder.andWhere(conditions.join(' OR '), parameters);
        } else {
          queryBuilder.andWhere(`FIND_IN_SET(:${paramKey}, ${dbColumn})`, {
            [paramKey]: value,
          });
        }
      } else if (InstanceChecker.isFindOperator(value)) {
        const { type, value: resolvedValue } = resolveFindOperator(value);

        if (type === 'in') {
          queryBuilder.andWhere(`${dbColumn} IN (:...${paramKey})`, {
            [paramKey]: resolvedValue,
          });
        } else if (type === 'not') {
          if (Array.isArray(resolvedValue)) {
            queryBuilder.andWhere(`${dbColumn} NOT IN (:...${paramKey})`, {
              [paramKey]: resolvedValue,
            });
          } else {
            if (resolvedValue === null || resolvedValue === undefined) {
              queryBuilder.andWhere(`${dbColumn} IS NOT NULL`);
            } else {
              queryBuilder.andWhere(`${dbColumn} != :${paramKey}`, {
                [paramKey]: resolvedValue,
              });
            }
          }
        } else if (type === 'lessThan') {
          queryBuilder.andWhere(`${dbColumn} < :${paramKey}`, {
            [paramKey]: resolvedValue,
          });
        } else if (type === 'moreThan') {
          queryBuilder.andWhere(`${dbColumn} > :${paramKey}`, {
            [paramKey]: resolvedValue,
          });
        } else if (type === 'lessThanOrEqual') {
          queryBuilder.andWhere(`${dbColumn} <= :${paramKey}`, {
            [paramKey]: resolvedValue,
          });
        } else if (type === 'moreThanOrEqual') {
          queryBuilder.andWhere(`${dbColumn} >= :${paramKey}`, {
            [paramKey]: resolvedValue,
          });
        } else if (type === 'between') {
          const fromKey = `${paramKey}_from`;
          const toKey = `${paramKey}_to`;
          const [from, to] = Array.isArray(resolvedValue)
            ? resolvedValue
            : [undefined, undefined];
          queryBuilder.andWhere(
            `${dbColumn} BETWEEN :${fromKey} AND :${toKey}`,
            {
              [fromKey]: from,
              [toKey]: to,
            },
          );
        } else if (type === 'like') {
          queryBuilder.andWhere(`${dbColumn} LIKE :${paramKey}`, {
            [paramKey]: resolvedValue,
          });
        } else if (type === 'ilike') {
          const ilikeKey = `${paramKey}_ilike`;
          const val =
            typeof resolvedValue === 'string'
              ? resolvedValue.toLowerCase()
              : resolvedValue;
          queryBuilder.andWhere(`LOWER(${dbColumn}) LIKE :${ilikeKey}`, {
            [ilikeKey]: val,
          });
        } else if (type === 'isNull') {
          queryBuilder.andWhere(`${dbColumn} IS NULL`);
        } else if (type === 'arrayContains') {
          queryBuilder.andWhere(`${dbColumn} @> :${paramKey}`, {
            [paramKey]: resolvedValue,
          });
        } else if (type === 'arrayContainedBy') {
          queryBuilder.andWhere(`${dbColumn} <@ :${paramKey}`, {
            [paramKey]: resolvedValue,
          });
        } else if (type === 'arrayOverlap') {
          queryBuilder.andWhere(`${dbColumn} && :${paramKey}`, {
            [paramKey]: resolvedValue,
          });
        } else if (type === 'raw') {
          if (typeof resolvedValue === 'function') {
            const expr = resolvedValue(dbColumn);
            queryBuilder.andWhere(expr);
          } else if (typeof resolvedValue === 'string') {
            queryBuilder.andWhere(resolvedValue);
          } else {
            queryBuilder.andWhere(`${dbColumn} = :${paramKey}`, {
              [paramKey]: resolvedValue,
            });
          }
        } else if (type === 'and' || type === 'or') {
          const logicalMethod = type === 'and' ? 'andWhere' : 'orWhere';
          const parts = Array.isArray(resolvedValue)
            ? resolvedValue
            : [resolvedValue];

          queryBuilder.andWhere(
            new Brackets((qb) => {
              parts.forEach((part, idx) => {
                const subParamKey = `${paramKey}_${type}_${idx}`;
                if (InstanceChecker.isFindOperator(part)) {
                  const { type: subType, value: subValue } =
                    resolveFindOperator(part);
                  if (subType === 'in') {
                    qb[logicalMethod](`${dbColumn} IN (:...${subParamKey})`, {
                      [subParamKey]: subValue,
                    });
                  } else if (subType === 'not') {
                    if (Array.isArray(subValue)) {
                      qb[logicalMethod](
                        `${dbColumn} NOT IN (:...${subParamKey})`,
                        {
                          [subParamKey]: subValue,
                        },
                      );
                    } else {
                      if (subValue === null || subValue === undefined) {
                        qb[logicalMethod](`${dbColumn} IS NOT NULL`);
                      } else {
                        qb[logicalMethod](`${dbColumn} != :${subParamKey}`, {
                          [subParamKey]: subValue,
                        });
                      }
                    }
                  } else if (subType === 'lessThan') {
                    qb[logicalMethod](`${dbColumn} < :${subParamKey}`, {
                      [subParamKey]: subValue,
                    });
                  } else if (subType === 'moreThan') {
                    qb[logicalMethod](`${dbColumn} > :${subParamKey}`, {
                      [subParamKey]: subValue,
                    });
                  } else if (subType === 'lessThanOrEqual') {
                    qb[logicalMethod](`${dbColumn} <= :${subParamKey}`, {
                      [subParamKey]: subValue,
                    });
                  } else if (subType === 'moreThanOrEqual') {
                    qb[logicalMethod](`${dbColumn} >= :${subParamKey}`, {
                      [subParamKey]: subValue,
                    });
                  } else if (subType === 'between') {
                    const fromKey = `${subParamKey}_from`;
                    const toKey = `${subParamKey}_to`;
                    const [from, to] = Array.isArray(subValue)
                      ? subValue
                      : [undefined, undefined];
                    qb[logicalMethod](
                      `${dbColumn} BETWEEN :${fromKey} AND :${toKey}`,
                      {
                        [fromKey]: from,
                        [toKey]: to,
                      },
                    );
                  } else if (subType === 'like') {
                    qb[logicalMethod](`${dbColumn} LIKE :${subParamKey}`, {
                      [subParamKey]: subValue,
                    });
                  } else if (subType === 'ilike') {
                    const ilikeKey = `${subParamKey}_ilike`;
                    const val =
                      typeof subValue === 'string'
                        ? subValue.toLowerCase()
                        : subValue;
                    qb[logicalMethod](`LOWER(${dbColumn}) LIKE :${ilikeKey}`, {
                      [ilikeKey]: val,
                    });
                  } else if (subType === 'isNull') {
                    qb[logicalMethod](`${dbColumn} IS NULL`);
                  } else if (subType === 'arrayContains') {
                    qb[logicalMethod](`${dbColumn} @> :${subParamKey}`, {
                      [subParamKey]: subValue,
                    });
                  } else if (subType === 'arrayContainedBy') {
                    qb[logicalMethod](`${dbColumn} <@ :${subParamKey}`, {
                      [subParamKey]: subValue,
                    });
                  } else if (subType === 'arrayOverlap') {
                    qb[logicalMethod](`${dbColumn} && :${subParamKey}`, {
                      [subParamKey]: subValue,
                    });
                  } else if (subType === 'raw') {
                    if (typeof subValue === 'function') {
                      const expr = subValue(dbColumn);
                      qb[logicalMethod](expr);
                    } else if (typeof subValue === 'string') {
                      qb[logicalMethod](subValue);
                    } else {
                      qb[logicalMethod](`${dbColumn} = :${subParamKey}`, {
                        [subParamKey]: subValue,
                      });
                    }
                  } else {
                    qb[logicalMethod](`${dbColumn} = :${subParamKey}`, {
                      [subParamKey]: subValue,
                    });
                  }
                } else {
                  qb[logicalMethod](`${dbColumn} = :${subParamKey}`, {
                    [subParamKey]: part,
                  });
                }
              });
            }),
          );
        } else {
          if (resolvedValue === null || resolvedValue === undefined) {
            queryBuilder.andWhere(`${dbColumn} IS NULL`);
          } else {
            queryBuilder.andWhere(`${dbColumn} = :${paramKey}`, {
              [paramKey]: resolvedValue,
            });
          }
        }
      } else if (Array.isArray(value)) {
        queryBuilder.andWhere(`${dbColumn} IN (:...${paramKey})`, {
          [paramKey]: value,
        });
      } else {
        if (value === null || value === undefined) {
          queryBuilder.andWhere(`${dbColumn} IS NULL`);
        } else {
          queryBuilder.andWhere(`${dbColumn} = :${paramKey}`, {
            [paramKey]: value,
          });
        }
      }
    });
  }

  async fetchAllPaginated<T>(
    fetchFunction: (
      page: number,
      limit: number,
      whereCondition?: any,
    ) => Promise<any>,
    whereCondition?: any,
    pageSize = 1000,
  ): Promise<T[]> {
    let currentPage = 1;
    let hasNextPage = true;
    const allDocs: T[] = [];

    while (hasNextPage) {
      const result = await fetchFunction(currentPage, pageSize, whereCondition);
      allDocs.push(...(result.docs || []));

      const totalPages = result.totalPages || 1;
      hasNextPage = currentPage < totalPages;
      currentPage++;
    }

    return allDocs;
  }
}
