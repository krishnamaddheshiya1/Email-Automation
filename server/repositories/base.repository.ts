/**
 * Base repository contract for data persistence.
 * Note: Database functionality is strictly scoped for later phases.
 * This contract establishes architectural consistency for future repository implementations.
 */
export interface BaseRepository<T, ID = string, CreateDTO = Partial<T>> {
  findById(id: ID): Promise<T | null>;
  findAll(): Promise<T[]>;
  create(data: CreateDTO): Promise<T>;
  update(id: ID, data: Partial<T>): Promise<T>;
  delete(id: ID): Promise<boolean>;
}
