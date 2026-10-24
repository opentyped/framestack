// Filter and sort shapes shared by the server and the client. No Kysely here.

export const operators = [
  "eq",
  "ne",
  "lt",
  "gt",
  "lte",
  "gte",
  "in",
  "nin",
  "contains",
  "ncontains",
  "null",
  "nnull",
] as const;

export type Operator = (typeof operators)[number];
export type Value = string | number | boolean | null;

export interface Filter {
  field: string;
  operator: Operator;
  value?: Value | Value[];
}

export interface Sorter {
  field: string;
  order: "asc" | "desc";
}
